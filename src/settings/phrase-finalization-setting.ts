import type { SpeakingStyle } from '../sidecar/protocol';

const STYLE_DESCRIPTIONS: Record<SpeakingStyle, string> = {
  responsive: 'Finalizes after shorter pauses for faster completed text.',
  balanced: 'Uses the standard pause tolerance for everyday dictation.',
  patient: 'Waits through longer pauses so a thought is less likely to be split.',
};

export const PHRASE_FINALIZATION_TOOLTIP =
  'Applies to every transcription model. Live words can still update before the phrase is final. This changes voice-activity boundaries, not writing style or model accuracy. Responsive favors speed; Patient favors keeping pauses inside one phrase.';

export function phraseFinalizationDescription(style: SpeakingStyle): string {
  return STYLE_DESCRIPTIONS[style];
}
