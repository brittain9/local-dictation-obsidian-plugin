import { t } from '../shared/i18n';

export function diarizationSettingDescription(streamingModelSelected: boolean): string {
  return streamingModelSelected
    ? t('settings.speakerLabels.streamingLimitation')
    : t('settings.speakerLabels.desc');
}
