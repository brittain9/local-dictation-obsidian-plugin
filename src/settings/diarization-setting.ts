const BASE_DESCRIPTION = 'Label each phrase by speaker.';
const STREAMING_LIMITATION = 'Speaker labels require a batch model.';

export function diarizationSettingDescription(streamingModelSelected: boolean): string {
  return streamingModelSelected ? STREAMING_LIMITATION : BASE_DESCRIPTION;
}
