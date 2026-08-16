import type { SelectedModel } from '../models/model-management-types';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import type { TranslationErrorEvent } from '../sidecar/protocol';
import type { TranslationLanguage } from './languages';

export class HyMtTranslationError extends Error {
  constructor(readonly code: string, message: string, readonly details?: string) {
    super(message);
    this.name = 'HyMtTranslationError';
  }
}

interface HyMtTranslationOptions {
  accelerationPreference: 'auto' | 'cpu_only';
  modelSelection: SelectedModel;
  modelStorePathOverride?: string;
  onProgress: (completed: number, total: number) => void;
  onReady: () => void;
  sidecarConnection: Pick<
    SidecarConnection,
    'cancelTranslation' | 'startTranslation' | 'subscribe'
  >;
  signal: AbortSignal;
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
  texts: string[];
  translationId: string;
}

export async function translateWithHyMt(options: HyMtTranslationOptions): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      release();
      options.signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      options.sidecarConnection.cancelTranslation(options.translationId);
      finish(() => reject(new DOMException('Translation canceled.', 'AbortError')));
    };
    const release = options.sidecarConnection.subscribe((event) => {
      if (!('translationId' in event) || event.translationId !== options.translationId) return;
      switch (event.type) {
        case 'translation_started':
          options.onReady();
          break;
        case 'translation_progress':
          options.onProgress(event.completed, event.total);
          break;
        case 'translation_complete':
          finish(() => resolve(event.translations));
          break;
        case 'translation_cancelled':
          finish(() => reject(new DOMException('Translation canceled.', 'AbortError')));
          break;
        case 'translation_error':
          finish(() => reject(toTranslationError(event)));
          break;
      }
    });
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) {
      onAbort();
      return;
    }
    void options.sidecarConnection
      .startTranslation({
        accelerationPreference: options.accelerationPreference,
        modelSelection: options.modelSelection,
        ...(options.modelStorePathOverride === undefined
          ? {}
          : { modelStorePathOverride: options.modelStorePathOverride }),
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
        texts: options.texts,
        translationId: options.translationId,
      })
      .catch((error: unknown) => finish(() => reject(error)));
  });
}

function toTranslationError(event: TranslationErrorEvent): HyMtTranslationError {
  return new HyMtTranslationError(event.code, event.message, event.details);
}
