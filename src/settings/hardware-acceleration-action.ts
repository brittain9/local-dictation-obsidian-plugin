import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';
import {
  SidecarLifecycleConflictError,
  type SidecarLifecycleGate,
  type SidecarLifecycleLease,
} from '../sidecar/sidecar-lifecycle-gate';
import type { SettingAccess } from './setting-helpers';

export interface HardwareAccelerationActionDependencies {
  access: SettingAccess;
  feedback: Pick<UserFeedback, 'show'>;
  restartSidecar: () => Promise<void>;
  sidecarLifecycleGate: SidecarLifecycleGate;
}

export async function changeHardwareAcceleration(
  deps: HardwareAccelerationActionDependencies,
  enabled: boolean,
): Promise<void> {
  const previousPreference = deps.access.getSettings().accelerationPreference;
  let mutationLease: SidecarLifecycleLease;
  try {
    mutationLease = deps.sidecarLifecycleGate.acquireMutation();
  } catch (error) {
    if (!(error instanceof SidecarLifecycleConflictError)) throw error;
    deps.feedback.show({
      intent: 'warning',
      message:
        error.activeKind === 'speech'
          ? t('settings.hardwareAcceleration.busy')
          : t('settings.sidecar.operationInProgress'),
    });
    return;
  }

  let preferencePersisted = false;
  try {
    await deps.access.persistOne('accelerationPreference', enabled ? 'auto' : 'cpu_only');
    preferencePersisted = true;
    await deps.restartSidecar();
    deps.feedback.show({
      intent: 'success',
      message: enabled
        ? t('settings.hardwareAcceleration.on')
        : t('settings.hardwareAcceleration.off'),
    });
  } catch (error) {
    if (!preferencePersisted) {
      deps.feedback.show({
        cause: error,
        intent: 'error',
        message: t('settings.hardwareAcceleration.saveFailed'),
      });
      return;
    }

    try {
      await deps.access.persistOne('accelerationPreference', previousPreference);
    } catch (rollbackError) {
      deps.feedback.show({
        cause: rollbackError,
        intent: 'error',
        message: t('settings.hardwareAcceleration.rollbackSaveFailed'),
      });
      return;
    }

    try {
      await deps.restartSidecar();
    } catch (rollbackError) {
      deps.feedback.show({
        cause: rollbackError,
        intent: 'error',
        message: t('settings.hardwareAcceleration.rollbackRestartFailed'),
      });
      return;
    }

    deps.feedback.show({
      cause: error,
      intent: 'error',
      message: t('settings.hardwareAcceleration.restartFailedRolledBack'),
    });
  } finally {
    mutationLease.release();
  }
}
