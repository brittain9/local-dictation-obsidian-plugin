import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BERGAMOT_WORKER_SOURCE } from 'virtual:bergamot-worker-source';

import type { CatalogModelRecord, InstalledModelRecord } from '../models/model-management-types';
import type { BergamotTranslateRequest, BergamotWorkerResponse } from './bergamot-messages';
import type { TranslationLanguage } from './languages';
import {
  resolveTranslationPairArtifacts,
  TranslationModelIncompleteError,
} from './translation-artifacts';

export class TranslationCancelledError extends Error {
  constructor() {
    super('Translation was canceled.');
    this.name = 'TranslationCancelledError';
  }
}

interface TranslateWithBergamotOptions {
  catalogModel: CatalogModelRecord;
  installedModel: InstalledModelRecord;
  onProgress?: (completed: number, total: number) => void;
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
  const artifacts = resolveTranslationPairArtifacts(
    options.catalogModel,
    options.sourceLanguage,
    options.targetLanguage,
  );
  const artifactPath = (filename: string): string =>
    join(options.installedModel.installPath, filename);

  const [glueSource, wasmBinary, modelBytes, lexiconBytes, ...vocabularies] = await Promise.all([
    readText(artifactPath(artifacts.runtimeGlue.filename), artifacts.runtimeGlue.artifactId),
    readBytes(artifactPath(artifacts.runtime.filename), artifacts.runtime.artifactId),
    readBytes(artifactPath(artifacts.model.filename), artifacts.model.artifactId),
    readBytes(artifactPath(artifacts.lexicon.filename), artifacts.lexicon.artifactId),
    ...artifacts.vocabularies.map((artifact) =>
      readBytes(artifactPath(artifact.filename), artifact.artifactId),
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
        case 'progress':
          options.onProgress?.(response.completed, response.total);
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

async function readText(path: string, artifactId: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new TranslationModelIncompleteError(artifactId);
  }
}

async function readBytes(path: string, artifactId: string): Promise<ArrayBuffer> {
  try {
    const bytes = await readFile(path);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } catch {
    throw new TranslationModelIncompleteError(artifactId);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TranslationCancelledError();
}
