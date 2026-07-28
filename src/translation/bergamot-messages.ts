export interface BergamotTranslateRequest {
  type: 'translate';
  requestId: string;
  sourceLanguage: string;
  targetLanguage: string;
  texts: string[];
  wasmBinary: ArrayBuffer;
  model: ArrayBuffer;
  lexicon: ArrayBuffer;
  vocabularies: ArrayBuffer[];
}

export type BergamotWorkerResponse =
  | {
      type: 'ready';
      requestId: string;
    }
  | {
      type: 'progress';
      requestId: string;
      completed: number;
      total: number;
    }
  | {
      type: 'complete';
      requestId: string;
      translations: string[];
    }
  | {
      type: 'error';
      requestId: string;
      message: string;
    };
