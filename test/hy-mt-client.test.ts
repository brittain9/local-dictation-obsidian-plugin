import { describe, expect, it, vi } from 'vitest';

import type { SidecarEvent } from '../src/sidecar/protocol';
import { translateWithHyMt } from '../src/translation/hy-mt-client';

describe('translateWithHyMt', () => {
  it('ignores unrelated sidecar errors while waiting for its keyed result', async () => {
    let listener: ((event: SidecarEvent) => void) | undefined;
    const translation = translateWithHyMt({
      accelerationPreference: 'auto',
      modelSelection: {
        familyId: 'tencent_hy_mt',
        kind: 'catalog_model',
        modelId: 'tencent-hy-mt-1.5-1.8b-q4-k-m',
        runtimeId: 'llama_cpp',
      },
      onProgress: vi.fn(),
      onReady: vi.fn(),
      sidecarConnection: {
        cancelTranslation: vi.fn(),
        startTranslation: vi.fn(async () => {}),
        subscribe: (next: (event: SidecarEvent) => void) => {
          listener = next;
          return vi.fn();
        },
      } as never,
      signal: new AbortController().signal,
      sourceLanguage: 'en',
      targetLanguage: 'es',
      texts: ['Translate this.'],
      translationId: 'translation-1',
    });

    listener?.({
      code: 'transcription_failure',
      message: 'A dictation session failed.',
      sessionId: 'session-1',
      type: 'error',
    });
    listener?.({
      translations: ['Traduzca esto.'],
      translationId: 'translation-1',
      type: 'translation_complete',
    });

    await expect(translation).resolves.toEqual(['Traduzca esto.']);
  });

  it('fails the active job when the main sidecar exits unexpectedly', async () => {
    let listener: ((event: SidecarEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const startTranslation = vi.fn(async () => {});

    const translation = translateWithHyMt({
      accelerationPreference: 'auto',
      modelSelection: {
        familyId: 'tencent_hy_mt',
        kind: 'catalog_model',
        modelId: 'tencent-hy-mt-1.5-1.8b-q4-k-m',
        runtimeId: 'llama_cpp',
      },
      onProgress: vi.fn(),
      onReady: vi.fn(),
      sidecarConnection: {
        cancelTranslation: vi.fn(),
        startTranslation,
        subscribe: (next: (event: SidecarEvent) => void) => {
          listener = next;
          return unsubscribe;
        },
      } as never,
      signal: new AbortController().signal,
      sourceLanguage: 'en',
      targetLanguage: 'es',
      texts: ['Translate this.'],
      translationId: 'translation-1',
    });

    await vi.waitFor(() =>
      expect(startTranslation).toHaveBeenCalledExactlyOnceWith(expect.anything()),
    );
    listener?.({
      code: 'sidecar_exited',
      details: 'code: 9, signal: null',
      message: 'The sidecar process exited unexpectedly.',
      type: 'error',
    });

    await expect(translation).rejects.toThrow('The sidecar process exited unexpectedly.');
    expect(unsubscribe).toHaveBeenCalledExactlyOnceWith();
  });
});
