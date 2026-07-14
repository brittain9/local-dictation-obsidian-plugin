import type { PluginSettings } from './plugin-settings';

export interface ModalSettingsPersistence {
  getSettings: () => PluginSettings;
  onSave?: () => void;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

export class ModalSettingsAutoSaver {
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: ModalSettingsPersistence) {}

  persist(patch: Partial<PluginSettings>): Promise<void> {
    const operation = this.operationTail.then(async () => {
      await this.dependencies.saveSettings({
        ...this.dependencies.getSettings(),
        ...patch,
      });
      this.dependencies.onSave?.();
    });
    this.operationTail = operation.catch(() => {});
    return operation;
  }
}
