import { Setting } from 'obsidian';

import { t } from '../shared/i18n';
import { type AccelerationSnapshot, describeAcceleration } from './acceleration-info';
import {
  changeHardwareAcceleration,
  type HardwareAccelerationActionDependencies,
} from './hardware-acceleration-action';

export interface HardwareAccelerationSettingDependencies
  extends HardwareAccelerationActionDependencies {
  acceleration: AccelerationSnapshot | null;
}

export function renderHardwareAccelerationSetting(
  container: HTMLElement,
  deps: HardwareAccelerationSettingDependencies,
): Setting {
  const setting = new Setting(container)
    .setName(t('settings.hardwareAcceleration.name'))
    .setDesc(t('settings.hardwareAcceleration.desc'));

  renderAccelerationStatus(setting, deps);

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

/**
 * Reports what the engine actually ended up running on, and why it is not the
 * GPU when it is not. Without this the sidecar's fallback to CPU is invisible —
 * the toggle stays on and nothing anywhere says the GPU was rejected.
 */
function renderAccelerationStatus(
  setting: Setting,
  deps: HardwareAccelerationSettingDependencies,
): void {
  const { label, fallbacks } = describeAcceleration(
    deps.acceleration,
    deps.access.getSettings().accelerationPreference,
  );

  setting.descEl.createDiv({
    cls: 'local-stt-acceleration-status',
    text: t('settings.acceleration.active', { accelerator: label }),
  });

  // Every ONNX engine shares one runtime, so a single missing dependency
  // produces an identical reason per engine. Show it once.
  for (const reason of new Set(fallbacks.map((fallback) => fallback.reason))) {
    setting.descEl.createDiv({ cls: 'local-stt-acceleration-fallback', text: reason });
  }
}
