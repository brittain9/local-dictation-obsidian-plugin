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

  const status = setting.descEl.createDiv();
  renderAccelerationStatus(status, deps);

  setting.addToggle((toggle) => {
    let pending = false;
    // Redrawn on every settle, not just the initial build: flipping the toggle
    // changes the answer immediately (`cpu_only` means CPU regardless of what
    // the sidecar reported), and a stale line contradicting the switch beside
    // it is worse than no line at all.
    const restoreToggleFromSettings = (): void => {
      toggle.setValue(deps.access.getSettings().accelerationPreference === 'auto');
      renderAccelerationStatus(status, deps);
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
 * Reports the route selected from the sidecar's advertised capabilities, and a
 * probe failure when the runtime exposes one. This deliberately does not claim
 * to observe the backend after model load; that requires a separate protocol
 * signal from the inference engine.
 */
function renderAccelerationStatus(
  container: HTMLElement,
  deps: HardwareAccelerationSettingDependencies,
): void {
  const { label, fallbacks } = describeAcceleration(
    deps.acceleration,
    deps.access.getSettings().accelerationPreference,
  );

  container.empty();
  container.createDiv({
    cls: 'local-stt-acceleration-status',
    text: t('settings.acceleration.active', { accelerator: label }),
  });

  // Every ONNX engine shares one runtime, so a single missing dependency
  // produces an identical reason per engine. Show it once.
  for (const reason of new Set(fallbacks.map((fallback) => fallback.reason))) {
    container.createDiv({ cls: 'local-stt-acceleration-fallback', text: reason });
  }
}
