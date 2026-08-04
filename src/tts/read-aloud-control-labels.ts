import { formatVoiceLabel } from '../shared/format-utils';
import { t } from '../shared/i18n';

export const READ_ALOUD_SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2] as const;

interface ReadAloudControlSelection {
  modelName: string;
  speed: number;
  voiceId: string;
}

export function readAloudControlLabels(
  state: 'paused' | 'reading',
  selection: ReadAloudControlSelection,
) {
  const speedValue = `${selection.speed}×`;
  return {
    model: t('tts.control.model', { model: selection.modelName }),
    pauseResume: state === 'paused' ? t('tts.control.resume') : t('tts.control.pause'),
    speed: t('tts.control.speed', { speed: speedValue }),
    speedValue,
    state: state === 'paused' ? t('tts.status.paused') : t('tts.status.reading'),
    stop: t('tts.control.stop'),
    voice: t('tts.control.voice', { voice: formatVoiceLabel(selection.voiceId) }),
  };
}
