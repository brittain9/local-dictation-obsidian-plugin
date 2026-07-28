import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BERGAMOT_WORKER_SOURCE } from 'virtual:bergamot-worker-source';

import type {
  CatalogModelRecord,
  InstalledModelRecord,
  ModelArtifactRecord,
} from '../models/model-management-types';
import type { BergamotTranslateRequest, BergamotWorkerResponse } from './bergamot-messages';
import type { TranslationLanguage } from './languages';

export class TranslationCancelledError extends Error {
  constructor() {
    super('Translation was canceled.');
    this.name = 'TranslationCancelledError';
  }
}

interface TranslateWithBergamotOptions {
  catalogModel: CatalogModelRecord;
  installedModel: InstalledModelRecord;
  onReady?: () => void;
  signal: AbortSignal;
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
  texts: string[];
}

export async function translateWithBergamot(
  options: TranslateWithBergamotOptions,
): Promise<string[]> {
  throwIfAborted(options.signal);
  const pairPrefix = `${options.sourceLanguage}_${options.targetLanguage}`;
  const runtime = requireArtifact(options.catalogModel, 'runtime');
  const runtimeGlue = requireArtifact(options.catalogModel, 'runtime_glue');
  const model = requireArtifact(options.catalogModel, `${pairPrefix}_model`);
  const lexicon = requireArtifact(options.catalogModel, `${pairPrefix}_lexicon`);
  const vocabularyArtifacts = resolveVocabularyArtifacts(options.catalogModel, pairPrefix);

  const [glueSource, wasmBinary, modelBytes, lexiconBytes, ...vocabularies] = await Promise.all([
    readFile(join(options.installedModel.installPath, runtimeGlue.filename), 'utf8'),
    readBytes(join(options.installedModel.installPath, runtime.filename)),
    readBytes(join(options.installedModel.installPath, model.filename)),
    readBytes(join(options.installedModel.installPath, lexicon.filename)),
    ...vocabularyArtifacts.map((artifact) =>
      readBytes(join(options.installedModel.installPath, artifact.filename)),
    ),
  ]);
  throwIfAborted(options.signal);

  const workerUrl = URL.createObjectURL(
    new Blob([glueSource, '\n', BERGAMOT_WORKER_SOURCE], { type: 'text/javascript' }),
  );
  let worker: Worker;
  try {
    worker = new Worker(workerUrl);
  } finally {
    URL.revokeObjectURL(workerUrl);
  }

  const request: BergamotTranslateRequest = {
    type: 'translate',
    requestId: crypto.randomUUID(),
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    texts: options.texts,
    wasmBinary,
    model: modelBytes,
    lexicon: lexiconBytes,
    vocabularies,
  };

  return new Promise<string[]>((resolve, reject) => {
    let settled = false;
    const finish = <T>(callback: (value: T) => void, value: T): void => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener('abort', onAbort);
      worker.terminate();
      callback(value);
    };
    const onAbort = (): void => {
      finish(reject, new TranslationCancelledError());
    };
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) {
      onAbort();
      return;
    }

    worker.onerror = (event) => {
      finish(reject, new Error(event.message || 'The local translation worker failed.'));
    };
    worker.onmessage = (event: MessageEvent<BergamotWorkerResponse>) => {
      const response = event.data;
      if (response.requestId !== request.requestId) return;
      switch (response.type) {
        case 'ready':
          options.onReady?.();
          return;
        case 'complete':
          finish(resolve, response.translations);
          return;
        case 'error':
          finish(reject, new Error(response.message));
      }
    };

    const transferable = [
      request.wasmBinary,
      request.model,
      request.lexicon,
      ...request.vocabularies,
    ];
    try {
      worker.postMessage(request, transferable);
    } catch (error) {
      finish(reject, error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function requireArtifact(model: CatalogModelRecord, artifactId: string): ModelArtifactRecord {
  const artifact = model.artifacts.find((candidate) => candidate.artifactId === artifactId);
  if (artifact === undefined) {
    throw new Error(`The installed translation model is missing ${artifactId}.`);
  }
  return artifact;
}

function resolveVocabularyArtifacts(
  model: CatalogModelRecord,
  pairPrefix: string,
): ModelArtifactRecord[] {
  const shared = model.artifacts.find(
    (artifact) => artifact.artifactId === `${pairPrefix}_vocabulary`,
  );
  if (shared !== undefined) return [shared];
  return [
    requireArtifact(model, `${pairPrefix}_source_vocabulary`),
    requireArtifact(model, `${pairPrefix}_target_vocabulary`),
  ];
}

async function readBytes(path: string): Promise<ArrayBuffer> {
  const bytes = await readFile(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TranslationCancelledError();
}
