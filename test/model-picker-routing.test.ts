import { describe, expect, it, vi } from 'vitest';

import { openModelPickerWithSetup } from '../src/models/model-picker-routing';

describe('openModelPickerWithSetup', () => {
  it('opens the requested picker when the sidecar is installed', async () => {
    const openPicker = vi.fn();
    const openSetupWizard = vi.fn(async () => {});

    await openModelPickerWithSetup(
      {
        isSidecarInstalled: vi.fn(async () => true),
        openPicker,
        openSetupWizard,
      },
      { initialTask: 'tts' },
    );

    expect(openPicker).toHaveBeenCalledExactlyOnceWith({ initialTask: 'tts' });
    expect(openSetupWizard).not.toHaveBeenCalled();
  });

  it('routes missing-sidecar recovery through setup and preserves setup failure', async () => {
    const failure = new Error('plugin directory unavailable');
    const openPicker = vi.fn();
    const openSetupWizard = vi.fn(async () => {
      throw failure;
    });

    await expect(
      openModelPickerWithSetup(
        {
          isSidecarInstalled: vi.fn(async () => false),
          openPicker,
          openSetupWizard,
        },
        { initialTask: 'tts' },
      ),
    ).rejects.toBe(failure);

    expect(openPicker).not.toHaveBeenCalled();
    expect(openSetupWizard).toHaveBeenCalledOnce();
  });
});
