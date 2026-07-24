import { Setting } from 'obsidian';

import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import { SidecarInUseError } from '../sidecar/sidecar-speech-interlock';
import type { SettingAccess } from './setting-helpers';

export interface HardwareAccelerationSettingDependencies {
  access: SettingAccess;
  feedback: Pick<UserFeedback, 'show'>;
  isSidecarInUse: () => boolean;
  restartSidecarWhenIdle: () => Promise<void>;
}

export function renderHardwareAccelerationSetting(
  container: HTMLElement,
  deps: HardwareAccelerationSettingDependencies,
): Setting {
  const setting = new Setting(container)
    .setName(t('settings.hardwareAcceleration.name'))
    .setDesc(t('settings.hardwareAcceleration.desc'));

  setting.addToggle((toggle) => {
    toggle.setValue(deps.access.getSettings().accelerationPreference === 'auto');
    toggle.onChange(async (value) => {
      const previousPreference = deps.access.getSettings().accelerationPreference;
      if (deps.isSidecarInUse()) {
        deps.feedback.show({
          intent: 'warning',
          message: t('settings.hardwareAcceleration.busy'),
        });
        toggle.setValue(previousPreference === 'auto');
        return;
      }

      await deps.access.persistOne('accelerationPreference', value ? 'auto' : 'cpu_only');
      try {
        await deps.restartSidecarWhenIdle();
        deps.feedback.show({
          intent: 'success',
          message: value
            ? t('settings.hardwareAcceleration.on')
            : t('settings.hardwareAcceleration.off'),
        });
      } catch (error) {
        if (error instanceof SidecarInUseError) {
          await deps.access.persistOne('accelerationPreference', previousPreference);
          toggle.setValue(previousPreference === 'auto');
          deps.feedback.show({
            intent: 'warning',
            message: error.userMessage,
          });
          return;
        }
        deps.feedback.show({
          cause: error,
          intent: 'error',
          message: t('settings.hardwareAcceleration.restartFailed'),
        });
      }
    });
  });

  return setting;
}
