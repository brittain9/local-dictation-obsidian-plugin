import type { ModelFamilyCapabilitiesRecord } from '../models/model-management-types';

export type DetailedTimestampSupport = 'segment' | 'unavailable' | 'word';

export interface TimestampCapabilityPresentation {
  detailedDescription: string;
  detailedOptionLabel: string;
  settingDescription: string;
  support: DetailedTimestampSupport;
}

export function timestampCapabilityPresentation(
  capabilities: ModelFamilyCapabilitiesRecord | null,
): TimestampCapabilityPresentation {
  if (capabilities?.supportsWordTimestamps) {
    return {
      detailedDescription:
        'Add an engine-timed marker before every word. Best for exact review; this creates dense output, may add processing time, and requires raw transcript mode.',
      detailedOptionLabel: 'Every word · model timed',
      settingDescription:
        'Add interval, phrase, or word-level timestamps. The selected model provides engine-timed words.',
      support: 'word',
    };
  }

  if (capabilities?.supportsSegmentTimestamps) {
    return {
      detailedDescription:
        'Add an engine-timed marker before every model segment. Best for exact review; this creates denser output and requires raw transcript mode.',
      detailedOptionLabel: 'Every model segment',
      settingDescription:
        'Add interval, phrase, or model-segment timestamps. The selected model provides engine-timed segments.',
      support: 'segment',
    };
  }

  return {
    detailedDescription:
      'The selected model does not provide detailed timing. Existing detailed sessions fall back to one voice-detected marker per phrase.',
    detailedOptionLabel: 'Detailed model timing · unavailable',
    settingDescription:
      'Add interval or phrase timestamps from voice-activity boundaries. The selected model does not provide word or segment timing.',
    support: 'unavailable',
  };
}
