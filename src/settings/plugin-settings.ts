import {
  isSelectedModel,
  normalizeSelectedModel,
  type SelectedModel,
} from '../models/model-management-types';
import { isRecord } from '../shared/type-guards';
import {
  type AccelerationPreference,
  LISTENING_MODES,
  type ListeningMode,
  type SpeakingStyle,
} from '../sidecar/protocol';

export const DICTATION_ANCHORS = ['at_cursor', 'end_of_note'] as const;

export type DictationAnchor = (typeof DICTATION_ANCHORS)[number];

export const TRANSCRIPT_FORMATTING_MODES = ['smart', 'space', 'new_line', 'new_paragraph'] as const;

export type TranscriptFormattingMode = (typeof TRANSCRIPT_FORMATTING_MODES)[number];

export const SPEAKING_STYLES = [
  'responsive',
  'balanced',
  'patient',
] as const satisfies readonly SpeakingStyle[];

export const DEFAULT_LLM_POSTPROCESS_SYSTEM_SLOT =
  'You clean a single dictated utterance. Use reference context only for spelling, terminology, continuity, and style. Never modify, continue, summarize, or quote the reference context. If the utterance already reads correctly, return it unchanged. Return only the cleaned utterance.';
export const DEFAULT_LLM_POSTPROCESS_VOICE_SLOT = '';
export const DEFAULT_LLM_POSTPROCESS_GLOSSARY_SLOT = '';
export const DEFAULT_LLM_POSTPROCESS_FORMAT_SLOT = '';
export const DEFAULT_LLM_POSTPROCESS_USER_TEMPLATE = `{{glossary}}

{{voice}}

{{format}}

<note_context>
{{note_context}}
</note_context>

<prior_utterances>
{{prior_utterances}}
</prior_utterances>

<utterance>
{{utterance}}
</utterance>

<cleaned>`;

export const DEFAULT_LLM_POSTPROCESS_CONTEXT = {
  glossaryChars: 1_000,
  noteContextChars: 3_000,
  priorUtterancesN: 2,
  totalContextCap: 7_000,
} as const;

export const DEFAULT_LLM_POSTPROCESS_GENERATION = {
  keepAlive: '30m',
  numPredict: 512,
  seed: 0,
  temperature: 0.2,
} as const;

export const DEFAULT_LLM_POSTPROCESS_SKIP = {
  minWords: 4,
  skipIfAvgLogprobAbove: null as number | null,
} as const;

export interface PluginSettings {
  accelerationPreference: AccelerationPreference;
  cudaLibraryPath: string;
  developerMode: boolean;
  dictationAnchor: DictationAnchor;
  listeningMode: ListeningMode;
  llmPostprocessEnabled: boolean;
  llmPostprocessFormatSlot: string;
  llmPostprocessGlossaryChars: number;
  llmPostprocessGlossarySlot: string;
  llmPostprocessKeepAlive: string;
  llmPostprocessModel: string;
  llmPostprocessNoteContextChars: number;
  llmPostprocessNumPredict: number;
  llmPostprocessPriorUtterancesN: number;
  llmPostprocessSeed: number;
  llmPostprocessShowRawBelow: boolean;
  llmPostprocessSkipIfAvgLogprobAbove: number | null;
  llmPostprocessSkipMinWords: number;
  llmPostprocessSystemSlot: string;
  llmPostprocessTemperature: number;
  llmPostprocessTotalContextCap: number;
  llmPostprocessUserTemplate: string;
  llmPostprocessVoiceSlot: string;
  modelStorePathOverride: string;
  selectedModel: SelectedModel | null;
  sidecarPathOverride: string;
  sidecarRequestTimeoutSeconds: number;
  sidecarStartupTimeoutSeconds: number;
  showTimestamps: boolean;
  speakingStyle: SpeakingStyle;
  transcriptFormatting: TranscriptFormattingMode;
  useNoteAsContext: boolean;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  accelerationPreference: 'auto',
  cudaLibraryPath: '',
  developerMode: false,
  dictationAnchor: 'at_cursor',
  listeningMode: 'always_on',
  llmPostprocessEnabled: false,
  llmPostprocessFormatSlot: DEFAULT_LLM_POSTPROCESS_FORMAT_SLOT,
  llmPostprocessGlossaryChars: DEFAULT_LLM_POSTPROCESS_CONTEXT.glossaryChars,
  llmPostprocessGlossarySlot: DEFAULT_LLM_POSTPROCESS_GLOSSARY_SLOT,
  llmPostprocessKeepAlive: DEFAULT_LLM_POSTPROCESS_GENERATION.keepAlive,
  llmPostprocessModel: '',
  llmPostprocessNoteContextChars: DEFAULT_LLM_POSTPROCESS_CONTEXT.noteContextChars,
  llmPostprocessNumPredict: DEFAULT_LLM_POSTPROCESS_GENERATION.numPredict,
  llmPostprocessPriorUtterancesN: DEFAULT_LLM_POSTPROCESS_CONTEXT.priorUtterancesN,
  llmPostprocessSeed: DEFAULT_LLM_POSTPROCESS_GENERATION.seed,
  llmPostprocessShowRawBelow: false,
  llmPostprocessSkipIfAvgLogprobAbove: DEFAULT_LLM_POSTPROCESS_SKIP.skipIfAvgLogprobAbove,
  llmPostprocessSkipMinWords: DEFAULT_LLM_POSTPROCESS_SKIP.minWords,
  llmPostprocessSystemSlot: DEFAULT_LLM_POSTPROCESS_SYSTEM_SLOT,
  llmPostprocessTemperature: DEFAULT_LLM_POSTPROCESS_GENERATION.temperature,
  llmPostprocessTotalContextCap: DEFAULT_LLM_POSTPROCESS_CONTEXT.totalContextCap,
  llmPostprocessUserTemplate: DEFAULT_LLM_POSTPROCESS_USER_TEMPLATE,
  llmPostprocessVoiceSlot: DEFAULT_LLM_POSTPROCESS_VOICE_SLOT,
  modelStorePathOverride: '',
  selectedModel: null,
  sidecarPathOverride: '',
  sidecarRequestTimeoutSeconds: 300,
  sidecarStartupTimeoutSeconds: 4,
  showTimestamps: false,
  speakingStyle: 'balanced',
  transcriptFormatting: 'smart',
  useNoteAsContext: true,
};

export function resolvePluginSettings(data: unknown): PluginSettings {
  const raw = isRecord(data) ? data : {};

  return {
    accelerationPreference: readAccelerationPreference(raw.accelerationPreference),
    cudaLibraryPath: readString(raw.cudaLibraryPath, DEFAULT_PLUGIN_SETTINGS.cudaLibraryPath),
    developerMode: readBoolean(raw.developerMode, DEFAULT_PLUGIN_SETTINGS.developerMode),
    dictationAnchor: isDictationAnchor(raw.dictationAnchor)
      ? raw.dictationAnchor
      : DEFAULT_PLUGIN_SETTINGS.dictationAnchor,
    listeningMode: readListeningMode(raw.listeningMode),
    llmPostprocessEnabled: readBoolean(
      raw.llmPostprocessEnabled,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessEnabled,
    ),
    llmPostprocessFormatSlot: readUserString(
      raw.llmPostprocessFormatSlot,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessFormatSlot,
    ),
    llmPostprocessGlossaryChars: readClampedInteger(
      raw.llmPostprocessGlossaryChars,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessGlossaryChars,
      0,
      4_000,
    ),
    llmPostprocessGlossarySlot: readUserString(
      raw.llmPostprocessGlossarySlot,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessGlossarySlot,
    ),
    llmPostprocessKeepAlive: readNonEmptyTrimmedString(
      raw.llmPostprocessKeepAlive,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessKeepAlive,
    ),
    llmPostprocessModel: readString(
      raw.llmPostprocessModel,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessModel,
    ),
    llmPostprocessNoteContextChars: readClampedInteger(
      raw.llmPostprocessNoteContextChars,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessNoteContextChars,
      0,
      12_000,
    ),
    llmPostprocessNumPredict: readClampedInteger(
      raw.llmPostprocessNumPredict,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessNumPredict,
      1,
      4_096,
    ),
    llmPostprocessPriorUtterancesN: readClampedInteger(
      raw.llmPostprocessPriorUtterancesN,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessPriorUtterancesN,
      0,
      5,
    ),
    llmPostprocessSeed: readClampedInteger(
      raw.llmPostprocessSeed,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessSeed,
      -2_147_483_648,
      2_147_483_647,
    ),
    llmPostprocessShowRawBelow: readBoolean(
      raw.llmPostprocessShowRawBelow,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessShowRawBelow,
    ),
    llmPostprocessSkipIfAvgLogprobAbove: readSkipIfAvgLogprobAbove(
      raw.llmPostprocessSkipIfAvgLogprobAbove,
    ),
    llmPostprocessSkipMinWords: readClampedInteger(
      raw.llmPostprocessSkipMinWords,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessSkipMinWords,
      0,
      50,
    ),
    llmPostprocessSystemSlot: readUserString(
      raw.llmPostprocessSystemSlot,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessSystemSlot,
    ),
    llmPostprocessTemperature: readClampedNumber(
      raw.llmPostprocessTemperature,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessTemperature,
      0,
      2,
    ),
    llmPostprocessTotalContextCap: readClampedInteger(
      raw.llmPostprocessTotalContextCap,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessTotalContextCap,
      0,
      30_000,
    ),
    llmPostprocessUserTemplate: readUserString(
      raw.llmPostprocessUserTemplate,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessUserTemplate,
    ),
    llmPostprocessVoiceSlot: readUserString(
      raw.llmPostprocessVoiceSlot,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessVoiceSlot,
    ),
    modelStorePathOverride: readString(
      raw.modelStorePathOverride,
      DEFAULT_PLUGIN_SETTINGS.modelStorePathOverride,
    ),
    selectedModel: readSelectedModel(raw.selectedModel),
    sidecarPathOverride: readString(
      raw.sidecarPathOverride,
      DEFAULT_PLUGIN_SETTINGS.sidecarPathOverride,
    ),
    sidecarRequestTimeoutSeconds: readPositiveInteger(
      raw.sidecarRequestTimeoutSeconds,
      DEFAULT_PLUGIN_SETTINGS.sidecarRequestTimeoutSeconds,
    ),
    sidecarStartupTimeoutSeconds: readPositiveInteger(
      raw.sidecarStartupTimeoutSeconds,
      DEFAULT_PLUGIN_SETTINGS.sidecarStartupTimeoutSeconds,
    ),
    showTimestamps: readBoolean(raw.showTimestamps, DEFAULT_PLUGIN_SETTINGS.showTimestamps),
    speakingStyle: isSpeakingStyle(raw.speakingStyle)
      ? raw.speakingStyle
      : DEFAULT_PLUGIN_SETTINGS.speakingStyle,
    transcriptFormatting: isTranscriptFormattingMode(raw.transcriptFormatting)
      ? raw.transcriptFormatting
      : DEFAULT_PLUGIN_SETTINGS.transcriptFormatting,
    useNoteAsContext: readBoolean(raw.useNoteAsContext, DEFAULT_PLUGIN_SETTINGS.useNoteAsContext),
  };
}

export function resetLlmPostprocessDefaults(settings: PluginSettings): PluginSettings {
  return {
    ...settings,
    llmPostprocessFormatSlot: DEFAULT_PLUGIN_SETTINGS.llmPostprocessFormatSlot,
    llmPostprocessGlossaryChars: DEFAULT_PLUGIN_SETTINGS.llmPostprocessGlossaryChars,
    llmPostprocessGlossarySlot: DEFAULT_PLUGIN_SETTINGS.llmPostprocessGlossarySlot,
    llmPostprocessKeepAlive: DEFAULT_PLUGIN_SETTINGS.llmPostprocessKeepAlive,
    llmPostprocessNoteContextChars: DEFAULT_PLUGIN_SETTINGS.llmPostprocessNoteContextChars,
    llmPostprocessNumPredict: DEFAULT_PLUGIN_SETTINGS.llmPostprocessNumPredict,
    llmPostprocessPriorUtterancesN: DEFAULT_PLUGIN_SETTINGS.llmPostprocessPriorUtterancesN,
    llmPostprocessSeed: DEFAULT_PLUGIN_SETTINGS.llmPostprocessSeed,
    llmPostprocessSkipIfAvgLogprobAbove:
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessSkipIfAvgLogprobAbove,
    llmPostprocessSkipMinWords: DEFAULT_PLUGIN_SETTINGS.llmPostprocessSkipMinWords,
    llmPostprocessSystemSlot: DEFAULT_PLUGIN_SETTINGS.llmPostprocessSystemSlot,
    llmPostprocessTemperature: DEFAULT_PLUGIN_SETTINGS.llmPostprocessTemperature,
    llmPostprocessTotalContextCap: DEFAULT_PLUGIN_SETTINGS.llmPostprocessTotalContextCap,
    llmPostprocessUserTemplate: DEFAULT_PLUGIN_SETTINGS.llmPostprocessUserTemplate,
    llmPostprocessVoiceSlot: DEFAULT_PLUGIN_SETTINGS.llmPostprocessVoiceSlot,
  };
}

function readAccelerationPreference(value: unknown): AccelerationPreference {
  if (value === 'auto' || value === 'cpu_only') {
    return value;
  }

  return DEFAULT_PLUGIN_SETTINGS.accelerationPreference;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readNonEmptyTrimmedString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function readUserString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function readClampedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function readClampedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function readSkipIfAvgLogprobAbove(value: unknown): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value > -10 && value <= 0 ? value : null;
}

export function isSpeakingStyle(value: unknown): value is SpeakingStyle {
  return typeof value === 'string' && (SPEAKING_STYLES as readonly string[]).includes(value);
}

export function isDictationAnchor(value: unknown): value is DictationAnchor {
  return typeof value === 'string' && (DICTATION_ANCHORS as readonly string[]).includes(value);
}

export function isTranscriptFormattingMode(value: unknown): value is TranscriptFormattingMode {
  return (
    typeof value === 'string' && (TRANSCRIPT_FORMATTING_MODES as readonly string[]).includes(value)
  );
}

export function isListeningMode(value: unknown): value is ListeningMode {
  return typeof value === 'string' && (LISTENING_MODES as readonly string[]).includes(value);
}

function readSelectedModel(selectedModel: unknown): SelectedModel | null {
  if (isSelectedModel(selectedModel)) {
    return normalizeSelectedModel(selectedModel);
  }

  return DEFAULT_PLUGIN_SETTINGS.selectedModel;
}

function readListeningMode(value: unknown): ListeningMode {
  return isListeningMode(value) ? value : DEFAULT_PLUGIN_SETTINGS.listeningMode;
}
