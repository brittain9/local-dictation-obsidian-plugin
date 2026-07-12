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
      message:
        'Saved microphone unavailable. Using the default microphone, but this change could not be saved. Select an available microphone in Settings before restarting Obsidian.',
    });
    return;
  }

  if (!cleared) {
    dependencies.feedback.show({
      intent: 'warning',
      key: 'microphone-device-fallback',
      message:
        'Saved microphone unavailable. Using the default microphone for this session; the current microphone setting was left unchanged.',
    });
    return;
  }

  dependencies.feedback.show({
    intent: 'warning',
    key: 'microphone-device-fallback',
    message:
      'Saved microphone unavailable. Using the default microphone; the saved selection was cleared for future sessions.',
  });
}
