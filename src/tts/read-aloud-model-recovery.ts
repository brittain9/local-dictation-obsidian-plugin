import type { ModelPickerOptions } from '../models/manage-models-modal';

export function openReadAloudModelRecovery(
  openModelPicker: (options: ModelPickerOptions) => Promise<void>,
): Promise<void> {
  return openModelPicker({ initialTask: 'tts' });
}
