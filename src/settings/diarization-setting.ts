const BASE_DESCRIPTION =
  'Label each utterance with a detected speaker (Speaker 1, Speaker 2, …). Runs fully on-device; no audio leaves your machine.';
const STREAMING_LIMITATION =
  'Not applied while a streaming (live) model is selected — speaker labels currently require a batch model.';

export function diarizationSettingDescription(streamingModelSelected: boolean): string {
  return streamingModelSelected ? `${BASE_DESCRIPTION} ${STREAMING_LIMITATION}` : BASE_DESCRIPTION;
}
