import type { ModelPickerOptions } from './manage-models-modal';

export const READ_ALOUD_MODEL_PICKER_OPTIONS = {
  initialTask: 'tts',
} as const satisfies ModelPickerOptions;

interface ModelPickerRoutingDependencies {
  isSidecarInstalled: () => Promise<boolean>;
  openPicker: (options: ModelPickerOptions) => void;
  openSetupWizard: () => Promise<void>;
}

export async function openModelPickerWithSetup(
  deps: ModelPickerRoutingDependencies,
  options: ModelPickerOptions,
): Promise<void> {
  if (!(await deps.isSidecarInstalled())) {
    await deps.openSetupWizard();
    return;
  }
  deps.openPicker(options);
}
