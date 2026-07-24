import { Setting } from 'obsidian';

import { t } from '../shared/i18n';
import {
  changeHardwareAcceleration,
  type HardwareAccelerationActionDependencies,
} from './hardware-acceleration-action';

export type HardwareAccelerationSettingDependencies = HardwareAccelerationActionDependencies;

export function renderHardwareAccelerationSetting(
  container: HTMLElement,
  deps: HardwareAccelerationSettingDependencies,
): Setting {
  const setting = new Setting(container)
    .setName(t('settings.hardwareAcceleration.name'))
    .setDesc(t('settings.hardwareAcceleration.desc'));

  setting.addToggle((toggle) => {
    let pending = false;
    const restoreToggleFromSettings = (): void => {
      toggle.setValue(deps.access.getSettings().accelerationPreference === 'auto');
    };
    restoreToggleFromSettings();

    toggle.onChange(async (value) => {
      if (pending) {
        restoreToggleFromSettings();
        return;
      }

      pending = true;
      toggle.setDisabled(true);
      try {
        await changeHardwareAcceleration(deps, value);
      } finally {
        restoreToggleFromSettings();
        pending = false;
        toggle.setDisabled(false);
      }
    });
  });

  return setting;
}
