import type { BergamotTranslateRequest, BergamotWorkerResponse } from './bergamot-messages';

interface Deletable {
  delete(): void;
}

interface AlignedMemory extends Deletable {
  getByteArrayView(): Uint8Array;
}

interface AlignedMemoryList extends Deletable {
  push_back(memory: AlignedMemory): void;
}

interface VectorString extends Deletable {
  push_back(value: string): void;
}

interface VectorResponseOptions extends Deletable {
  push_back(value: { alignment: boolean; html: boolean; qualityScores: boolean }): void;
}

interface TranslationResponses extends Deletable {
  get(index: number): {
    getTranslatedText(): string;
  };
}

type TranslationModel = Deletable;

interface BlockingService extends Deletable {
  translate(
    model: TranslationModel,
    messages: VectorString,
    options: VectorResponseOptions,
  ): TranslationResponses;
}

interface BergamotModule {
  AlignedMemory: new (size: number, alignment: number) => AlignedMemory;
  AlignedMemoryList: new () => AlignedMemoryList;
  BlockingService: new (options: { cacheSize: number }) => BlockingService;
  TranslationModel: new (
    sourceLanguage: string,
    targetLanguage: string,
    config: string,
    model: AlignedMemory,
    lexicon: AlignedMemory,
    vocabularies: AlignedMemoryList,
    qualityModel: null,
  ) => TranslationModel;
  VectorResponseOptions: new () => VectorResponseOptions;
  VectorString: new () => VectorString;
}

interface LoadBergamot {
  call(thisArg: typeof self, config: Record<string, unknown>): BergamotModule;
}

declare const loadBergamot: LoadBergamot;

interface TranslationWorkerScope {
  onmessage: ((event: MessageEvent<BergamotTranslateRequest>) => void) | null;
  postMessage(message: BergamotWorkerResponse): void;
}

const workerScope = self as unknown as TranslationWorkerScope;

const TRANSLATION_BATCH_SIZE = 8;

const BERGAMOT_CONFIG = `
beam-size: 1
normalize: 1.0
word-penalty: 0
max-length-break: 128
mini-batch-words: 1024
workspace: 128
max-length-factor: 2.0
skip-cost: true
cpu-threads: 0
quiet: true
quiet-translation: true
gemm-precision: int8shiftAlphaAll
alignment: soft
`;

workerScope.onmessage = (event) => {
  void translate(event.data);
};

async function translate(request: BergamotTranslateRequest): Promise<void> {
  const resources: Deletable[] = [];
  try {
    const bergamot = await initializeRuntime(request.wasmBinary);
    workerScope.postMessage({ type: 'ready', requestId: request.requestId });

    const modelMemory = align(bergamot, request.model, 256);
    const lexiconMemory = align(bergamot, request.lexicon, 64);
    const vocabularyMemories = request.vocabularies.map((bytes) => align(bergamot, bytes, 64));
    resources.push(modelMemory, lexiconMemory, ...vocabularyMemories);

    const vocabularyList = new bergamot.AlignedMemoryList();
    resources.push(vocabularyList);
    for (const vocabulary of vocabularyMemories) {
      vocabularyList.push_back(vocabulary);
    }

    const model = new bergamot.TranslationModel(
      request.sourceLanguage,
      request.targetLanguage,
      BERGAMOT_CONFIG,
      modelMemory,
      lexiconMemory,
      vocabularyList,
      null,
    );
    const service = new bergamot.BlockingService({ cacheSize: 0 });
    resources.push(model, service);

    // Translating in batches bounds the WebAssembly workspace a single call has
    // to hold, and lets a long note report progress instead of going quiet.
    const translations: string[] = [];
    for (let offset = 0; offset < request.texts.length; offset += TRANSLATION_BATCH_SIZE) {
      const batch = request.texts.slice(offset, offset + TRANSLATION_BATCH_SIZE);
      const batchResources: Deletable[] = [];
      try {
        const messages = new bergamot.VectorString();
        const options = new bergamot.VectorResponseOptions();
        batchResources.push(messages, options);
        for (const text of batch) {
          messages.push_back(text);
          options.push_back({ qualityScores: false, alignment: true, html: false });
        }
        const responses = service.translate(model, messages, options);
        batchResources.push(responses);
        for (let index = 0; index < batch.length; index += 1) {
          translations.push(responses.get(index).getTranslatedText());
        }
      } finally {
        for (const resource of batchResources.reverse()) {
          resource.delete();
        }
      }
      workerScope.postMessage({
        type: 'progress',
        requestId: request.requestId,
        completed: translations.length,
        total: request.texts.length,
      });
    }
    workerScope.postMessage({
      type: 'complete',
      requestId: request.requestId,
      translations,
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    for (const resource of resources.reverse()) {
      resource.delete();
    }
  }
}

function initializeRuntime(wasmBinary: ArrayBuffer): Promise<BergamotModule> {
  return new Promise((resolve, reject) => {
    let bergamot: BergamotModule;
    bergamot = loadBergamot.call(self, {
      INITIAL_MEMORY: 234_291_200,
      wasmBinary,
      print: () => {},
      printErr: () => {},
      onAbort: () => {
        reject(new Error('The local translation runtime stopped unexpectedly.'));
      },
      onRuntimeInitialized: () => {
        resolve(bergamot);
      },
    });
  });
}

function align(bergamot: BergamotModule, bytes: ArrayBuffer, alignment: number): AlignedMemory {
  const memory = new bergamot.AlignedMemory(bytes.byteLength, alignment);
  memory.getByteArrayView().set(new Uint8Array(bytes));
  return memory;
}
