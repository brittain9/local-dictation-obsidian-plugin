import type { ModelPickerOptions } from './manage-models-modal';

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
