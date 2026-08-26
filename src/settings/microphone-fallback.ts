import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';

interface MicrophoneFallbackDependencies {
  clearSelectionIfMatches: (unavailableDeviceId: string) => Promise<boolean>;
  feedback: Pick<UserFeedback, 'show'>;
}

export async function handleMicrophoneDeviceFallback(
  unavailableDeviceId: string,
  dependencies: MicrophoneFallbackDependencies,
): Promise<void> {
  let cleared: boolean;

  try {
    cleared = await dependencies.clearSelectionIfMatches(unavailableDeviceId);
  } catch (error) {
    dependencies.feedback.show({
      cause: error,
      intent: 'warning',
      key: 'microphone-device-fallback',
      message: t('settings.microphone.fallbackSaveFailed'),
    });
    return;
  }

  if (!cleared) {
    dependencies.feedback.show({
      intent: 'warning',
      key: 'microphone-device-fallback',
      message: t('settings.microphone.fallbackUnchanged'),
    });
    return;
  }

  dependencies.feedback.show({
    intent: 'warning',
    key: 'microphone-device-fallback',
    message: t('settings.microphone.fallbackCleared'),
  });
}
