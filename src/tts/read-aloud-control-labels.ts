import { formatVoiceLabel } from '../shared/format-utils';
import { t } from '../shared/i18n';

export function readAloudControlLabels(state: 'paused' | 'reading', voiceId: string) {
  return {
    pauseResume: state === 'paused' ? t('tts.control.resume') : t('tts.control.pause'),
    state: state === 'paused' ? t('tts.status.paused') : t('tts.status.reading'),
    stop: t('tts.control.stop'),
    voice: t('tts.control.voice', { voice: formatVoiceLabel(voiceId) }),
  };
}
