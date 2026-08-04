import { t } from '../shared/i18n';
import type { SpeakingStyle } from '../sidecar/protocol';

export const PHRASE_FINALIZATION_TOOLTIP = t('settings.phraseFinalization.tooltip');

export function phraseFinalizationDescription(style: SpeakingStyle): string {
  return t(`settings.phraseFinalization.${style}`);
}
