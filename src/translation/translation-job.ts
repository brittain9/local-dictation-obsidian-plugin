import type { CatalogModelRecord } from '../models/model-management-types';
import type { TranslationLanguage } from './languages';

export type TranslationJobResult =
  | { kind: 'missing_model' }
  | { kind: 'translated'; sourceUnitsKept: number; text: string };

export type TranslationJobState =
  | { phase: 'idle' }
  | { phase: 'loading'; startedAt: number }
  | { completed: number; phase: 'translating'; startedAt: number; total: number }
  | { phase: 'missing_model' }
  | { phase: 'completed'; sourceUnitsKept: number; text: string }
  | { phase: 'cancelled' }
  | { error: unknown; phase: 'failed' };

export interface TranslationJobRunOptions {
  onProgress: (completed: number, total: number) => void;
  onReady: () => void;
  signal: AbortSignal;
}

interface TranslationJobOptions {
  model: CatalogModelRecord | null;
  run: (options: TranslationJobRunOptions) => Promise<TranslationJobResult>;
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
}

type Listener = (state: TranslationJobState) => void;

export class TranslationJob {
  readonly model: CatalogModelRecord | null;
  readonly sourceLanguage: TranslationLanguage;
  readonly targetLanguage: TranslationLanguage;
  private abortController: AbortController | null = null;
  private currentState: TranslationJobState = { phase: 'idle' };
  private readonly listeners = new Set<Listener>();

  constructor(private readonly options: TranslationJobOptions) {
    this.model = options.model;
    this.sourceLanguage = options.sourceLanguage;
    this.targetLanguage = options.targetLanguage;
  }

  state(): TranslationJobState {
    return this.currentState;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.currentState.phase !== 'idle') return;
    const abortController = new AbortController();
    const startedAt = Date.now();
    this.abortController = abortController;
    this.setState({ phase: 'loading', startedAt });
    void this.options
      .run({
        onProgress: (completed, total) => {
          if (!abortController.signal.aborted) {
            this.setState({ completed, phase: 'translating', startedAt, total });
          }
        },
        onReady: () => {
          if (!abortController.signal.aborted) {
            this.setState({ completed: 0, phase: 'translating', startedAt, total: 0 });
          }
        },
        signal: abortController.signal,
      })
      .then((result) => {
        if (abortController.signal.aborted) return;
        this.abortController = null;
        this.setState(
          result.kind === 'missing_model'
            ? { phase: 'missing_model' }
            : {
                phase: 'completed',
                sourceUnitsKept: result.sourceUnitsKept,
                text: result.text,
              },
        );
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return;
        this.abortController = null;
        this.setState({ error, phase: 'failed' });
      });
  }

  cancel(): void {
    if (this.abortController === null) return;
    this.abortController.abort();
    this.abortController = null;
    this.setState({ phase: 'cancelled' });
  }

  private setState(state: TranslationJobState): void {
    this.currentState = state;
    for (const listener of this.listeners) listener(state);
  }
}
