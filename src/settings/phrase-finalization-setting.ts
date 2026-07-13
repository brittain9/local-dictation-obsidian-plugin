import type { SpeakingStyle } from '../sidecar/protocol';

const STYLE_DESCRIPTIONS: Record<SpeakingStyle, string> = {
  responsive: 'Finalizes after shorter pauses for faster completed text.',
  balanced: 'Uses the standard pause tolerance for everyday dictation.',
  patient: 'Waits through longer pauses so a thought is less likely to be split.',
};

const SHARED_DESCRIPTION =
  'Applies to every transcription model, including live models; live words can still update before the phrase is final.';

export const PHRASE_FINALIZATION_TOOLTIP =
  'This changes voice-activity boundaries, not writing style or model accuracy. Responsive favors speed; Patient favors keeping pauses inside one phrase.';

export function phraseFinalizationDescription(style: SpeakingStyle): string {
  return `${STYLE_DESCRIPTIONS[style]} ${SHARED_DESCRIPTION}`;
}
