import { formatCatalogLanguageLabel } from '../language/dictation-language';
import { formatVoiceLabel } from '../shared/format-utils';
import { buildCapabilityLabels } from './capability-view';
import { localizeModelSummary } from './catalog-localization';
import {
  type CatalogModelRecord,
  type EngineCapabilitiesRecord,
  getTotalModelSize,
  type InstalledModelRecord,
} from './model-management-types';

export interface ModelDetailsVoice {
  id: string;
  label: string;
}

export interface AvailableModelDetailsVoice extends ModelDetailsVoice {
  isDefault: boolean;
}

export interface TextToSpeechModelDetails {
  availableVoices: AvailableModelDetailsVoice[];
  installedVoices: ModelDetailsVoice[];
  languages: string[];
  outputSampleRate: string | null;
  supportsSpeedControl: boolean;
}

export interface ModelDetailsPresentation {
  artifacts: CatalogModelRecord['artifacts'];
  capabilityLabels: string[] | null;
  displayName: string;
  installPath: string | null;
  licenseLabel: string;
  licenseUrl: string;
  modelCardUrl: string | null;
  sourceUrl: string;
  summary: string;
  totalSizeBytes: number;
  tts: TextToSpeechModelDetails | null;
}

export function buildModelDetailsPresentation(
  model: CatalogModelRecord,
  installedModel: InstalledModelRecord | null,
  capabilities: EngineCapabilitiesRecord | null,
): ModelDetailsPresentation {
  const matchingCapabilities = capabilitiesMatchModel(capabilities, model) ? capabilities : null;
  const tts =
    model.task === 'tts'
      ? buildTextToSpeechDetails(model, installedModel, matchingCapabilities)
      : null;

  return {
    artifacts: model.artifacts,
    capabilityLabels:
      matchingCapabilities === null
        ? null
        : buildCapabilityLabels(matchingCapabilities, {
            includeLanguageSupport: model.task !== 'tts',
          }),
    displayName: model.displayName,
    installPath: installedModel?.installPath ?? null,
    licenseLabel: model.licenseLabel,
    licenseUrl: model.licenseUrl,
    modelCardUrl: model.modelCardUrl,
    sourceUrl: model.sourceUrl,
    summary: localizeModelSummary(model.modelId, model.summary),
    totalSizeBytes: getTotalModelSize(model),
    tts,
  };
}

function buildTextToSpeechDetails(
  model: CatalogModelRecord,
  installedModel: InstalledModelRecord | null,
  capabilities: EngineCapabilitiesRecord | null,
): TextToSpeechModelDetails {
  const availableVoiceIds = new Set<string>();
  for (const artifact of model.artifacts) {
    if (
      artifact.role === 'voice' &&
      artifact.voiceId !== undefined &&
      artifact.voiceId.length > 0
    ) {
      availableVoiceIds.add(artifact.voiceId);
    }
  }

  return {
    availableVoices: [...availableVoiceIds].map((id) => ({
      id,
      isDefault: id === model.defaultVoice,
      label: formatVoiceLabel(id),
    })),
    installedVoices: (installedModel?.installedVoiceIds ?? [])
      .filter((id) => id.length > 0)
      .map((id) => ({ id, label: formatVoiceLabel(id) })),
    languages: model.languageTags.map(formatCatalogLanguageLabel),
    outputSampleRate: formatOutputSampleRate(capabilities?.family.outputSampleRate ?? null),
    supportsSpeedControl: capabilities?.family.supportsSpeedControl ?? false,
  };
}

function capabilitiesMatchModel(
  capabilities: EngineCapabilitiesRecord | null,
  model: CatalogModelRecord,
): capabilities is EngineCapabilitiesRecord {
  return (
    capabilities !== null &&
    capabilities.runtimeId === model.runtimeId &&
    capabilities.familyId === model.familyId &&
    capabilities.family.task === model.task
  );
}

function formatOutputSampleRate(sampleRate: number | null): string | null {
  if (sampleRate === null || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const kilohertz = sampleRate / 1_000;
  const label = Number.isInteger(kilohertz) ? String(kilohertz) : kilohertz.toFixed(1);
  return `${label} kHz`;
}
