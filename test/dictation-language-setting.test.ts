import { describe, expect, it, vi } from 'vitest';

import type { ModelPickerOptions } from '../src/models/manage-models-modal';
import { applyDictationLanguageChange } from '../src/settings/dictation-language-setting';

describe('dictation language setting', () => {
  it('guides a fresh install to compatible transcription models after saving the language', async () => {
    const persist = vi.fn(async () => {});
    const openModelPicker = vi.fn<(options: ModelPickerOptions) => Promise<void>>(async () => {});
    const show = vi.fn();
    const onModelChanged = vi.fn();

    await applyDictationLanguageChange('hr', {
      feedback: { show },
      hasSelectedModel: false,
      onModelChanged,
      openModelPicker,
      persist,
    });

    expect(persist).toHaveBeenCalledExactlyOnceWith('hr');
    expect(show).toHaveBeenCalledOnce();
    const request = show.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      intent: 'action-required',
      key: 'dictation-model-required',
      message: 'Choose a transcription model that supports Hrvatski before starting dictation.',
    });

    request?.action?.run();
    await vi.waitFor(() => {
      expect(openModelPicker).toHaveBeenCalledOnce();
    });
    expect(openModelPicker.mock.calls[0]?.[0]).toMatchObject({ initialTask: 'stt' });
    expect(openModelPicker.mock.calls[0]?.[0]?.onChanged).toBe(onModelChanged);
  });

  it('does not prompt when the selected model already constrains the available options', async () => {
    const persist = vi.fn(async () => {});
    const show = vi.fn();

    await applyDictationLanguageChange('en', {
      feedback: { show },
      hasSelectedModel: true,
      onModelChanged: vi.fn(),
      openModelPicker: vi.fn(async () => {}),
      persist,
    });

    expect(persist).toHaveBeenCalledExactlyOnceWith('en');
    expect(show).not.toHaveBeenCalled();
  });
});
