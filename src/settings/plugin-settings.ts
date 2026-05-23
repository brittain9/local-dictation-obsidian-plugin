import {
  DEFAULT_LLM_BUILTIN_PRESET_ID,
  findMatchingStyleRef,
  formatStyleRef,
  getLlmBuiltinPreset,
  isLlmPostprocessMode,
  isLlmPresetMode,
  type LlmPostprocessMode,
  type LlmUserPreset,
  resolveStyleOption,
} from '../llm/presets';
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

export const TIMESTAMP_CLOCKS = ['elapsed', 'wallclock'] as const;

export type TimestampClock = (typeof TIMESTAMP_CLOCKS)[number];

export const TIMESTAMP_DENSITIES = ['sparse', 'every_utterance'] as const;

export type TimestampDensity = (typeof TIMESTAMP_DENSITIES)[number];

export const DEFAULT_TIMESTAMP_SPARSE_INTERVAL_MS = 30_000;
export const MIN_TIMESTAMP_SPARSE_INTERVAL_MS = 10_000;
export const MAX_TIMESTAMP_SPARSE_INTERVAL_MS = 600_000;

export const SPEAKING_STYLES = [
  'responsive',
  'balanced',
  'patient',
] as const satisfies readonly SpeakingStyle[];

const DEFAULT_LLM_PRESET = getLlmBuiltinPreset(DEFAULT_LLM_BUILTIN_PRESET_ID);
const DEFAULT_LLM_ACTIVE_PRESET_REF = formatStyleRef({
  kind: 'builtin',
  id: DEFAULT_LLM_BUILTIN_PRESET_ID,
});

export const DEFAULT_LLM_POSTPROCESS_PROMPT = DEFAULT_LLM_PRESET.prompt;

export const DEFAULT_LLM_POSTPROCESS_CONTEXT = {
  noteContextChars: 3_000,
  priorUtterancesN: 2,
  totalContextCap: 7_000,
} as const;

export const DEFAULT_LLM_POSTPROCESS_GENERATION = {
  temperature: 0.2,
} as const;

export const DEFAULT_LLM_POSTPROCESS_SKIP = {
  minWords: 4,
} as const;

export const LLM_USER_PRESET_MAX_LABEL_CHARS = 60;
export const LLM_USER_PRESET_MAX_DESCRIPTION_CHARS = 240;
export const LLM_USER_PRESET_MAX_COUNT = 25;

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface PluginSettings {
  accelerationPreference: AccelerationPreference;
  audioInputDevice: AudioInputDevice | null;
  cudaLibraryPath: string;
  developerMode: boolean;
  dictationAnchor: DictationAnchor;
  listeningMode: ListeningMode;
  llmFeaturesEnabled: boolean;
  llmPostprocessActivePresetRef: string | null;
  llmPostprocessMode: LlmPostprocessMode;
  llmPostprocessModel: string;
  llmPostprocessNoteContextChars: number;
  llmPostprocessPriorUtterancesN: number;
  llmPostprocessPrompt: string;
  llmPostprocessShowRawBelow: boolean;
  llmPostprocessSkipMinWords: number;
  llmPostprocessTemperature: number;
  llmPostprocessTotalContextCap: number;
  llmPostprocessUserPresets: LlmUserPreset[];
  localTranscriptSidebarBootstrapped: boolean;
  modelStorePathOverride: string;
  schemaVersion: 1;
  selectedModel: SelectedModel | null;
  setupCompletedAt: string | null;
  sidecarPathOverride: string;
  sidecarRequestTimeoutSeconds: number;
  sidecarStartupTimeoutSeconds: number;
  speakingStyle: SpeakingStyle;
  timestampClock: TimestampClock;
  timestampDensity: TimestampDensity;
  timestampsEnabled: boolean;
  timestampSessionHeader: boolean;
  timestampSparseIntervalMs: number;
  transcriptFormatting: TranscriptFormattingMode;
  useLlmNoteContext: boolean;
  useNoteAsContext: boolean;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  accelerationPreference: 'auto',
  audioInputDevice: null,
  cudaLibraryPath: '',
  developerMode: false,
  dictationAnchor: 'at_cursor',
  listeningMode: 'always_on',
  llmFeaturesEnabled: true,
  llmPostprocessActivePresetRef: DEFAULT_LLM_ACTIVE_PRESET_REF,
  llmPostprocessMode: 'per_utterance',
  llmPostprocessModel: '',
  llmPostprocessNoteContextChars: DEFAULT_LLM_POSTPROCESS_CONTEXT.noteContextChars,
  llmPostprocessPriorUtterancesN: DEFAULT_LLM_POSTPROCESS_CONTEXT.priorUtterancesN,
  llmPostprocessPrompt: DEFAULT_LLM_POSTPROCESS_PROMPT,
  llmPostprocessShowRawBelow: false,
  llmPostprocessSkipMinWords: DEFAULT_LLM_POSTPROCESS_SKIP.minWords,
  llmPostprocessTemperature: DEFAULT_LLM_POSTPROCESS_GENERATION.temperature,
  llmPostprocessTotalContextCap: DEFAULT_LLM_POSTPROCESS_CONTEXT.totalContextCap,
  llmPostprocessUserPresets: [],
  localTranscriptSidebarBootstrapped: false,
  modelStorePathOverride: '',
  schemaVersion: 1,
  selectedModel: null,
  setupCompletedAt: null,
  sidecarPathOverride: '',
  sidecarRequestTimeoutSeconds: 300,
  sidecarStartupTimeoutSeconds: 4,
  speakingStyle: 'balanced',
  timestampClock: 'elapsed',
  timestampDensity: 'sparse',
  timestampsEnabled: false,
  timestampSessionHeader: true,
  timestampSparseIntervalMs: DEFAULT_TIMESTAMP_SPARSE_INTERVAL_MS,
  transcriptFormatting: 'smart',
  useLlmNoteContext: false,
  useNoteAsContext: true,
};

export function resolvePluginSettings(data: unknown): PluginSettings {
  const raw = isRecord(data) ? data : {};
  const userPresets = readUserPresets(raw.llmPostprocessUserPresets);
  const llmPostprocessPrompt = readPrompt(raw.llmPostprocessPrompt, DEFAULT_LLM_POSTPROCESS_PROMPT);
  const llmPostprocessActivePresetRef = readActivePresetRef(
    raw.llmPostprocessActivePresetRef,
    llmPostprocessPrompt,
    userPresets,
  );

  return {
    accelerationPreference: readAccelerationPreference(raw.accelerationPreference),
    audioInputDevice: readAudioInputDevice(raw.audioInputDevice),
    cudaLibraryPath: readString(raw.cudaLibraryPath, DEFAULT_PLUGIN_SETTINGS.cudaLibraryPath),
    developerMode: readBoolean(raw.developerMode, DEFAULT_PLUGIN_SETTINGS.developerMode),
    dictationAnchor: isDictationAnchor(raw.dictationAnchor)
      ? raw.dictationAnchor
      : DEFAULT_PLUGIN_SETTINGS.dictationAnchor,
    listeningMode: readListeningMode(raw.listeningMode),
    llmFeaturesEnabled: readBoolean(
      raw.llmFeaturesEnabled,
      DEFAULT_PLUGIN_SETTINGS.llmFeaturesEnabled,
    ),
    llmPostprocessActivePresetRef,
    llmPostprocessMode: readLlmPostprocessMode(raw.llmPostprocessMode),
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
    llmPostprocessPriorUtterancesN: readClampedInteger(
      raw.llmPostprocessPriorUtterancesN,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessPriorUtterancesN,
      0,
      5,
    ),
    llmPostprocessPrompt,
    llmPostprocessShowRawBelow: readBoolean(
      raw.llmPostprocessShowRawBelow,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessShowRawBelow,
    ),
    llmPostprocessSkipMinWords: readClampedInteger(
      raw.llmPostprocessSkipMinWords,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessSkipMinWords,
      0,
      50,
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
    llmPostprocessUserPresets: userPresets,
    localTranscriptSidebarBootstrapped: readBoolean(
      raw.localTranscriptSidebarBootstrapped,
      DEFAULT_PLUGIN_SETTINGS.localTranscriptSidebarBootstrapped,
    ),
    modelStorePathOverride: readString(
      raw.modelStorePathOverride,
      DEFAULT_PLUGIN_SETTINGS.modelStorePathOverride,
    ),
    // Bump `schemaVersion` and add a migration step when renaming a key or changing default semantics.
    schemaVersion: 1,
    selectedModel: readSelectedModel(raw.selectedModel),
    setupCompletedAt: readSetupCompletedAt(raw.setupCompletedAt),
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
    speakingStyle: isSpeakingStyle(raw.speakingStyle)
      ? raw.speakingStyle
      : DEFAULT_PLUGIN_SETTINGS.speakingStyle,
    timestampClock: isTimestampClock(raw.timestampClock)
      ? raw.timestampClock
      : DEFAULT_PLUGIN_SETTINGS.timestampClock,
    timestampDensity: isTimestampDensity(raw.timestampDensity)
      ? raw.timestampDensity
      : DEFAULT_PLUGIN_SETTINGS.timestampDensity,
    timestampsEnabled: readBoolean(
      raw.timestampsEnabled,
      DEFAULT_PLUGIN_SETTINGS.timestampsEnabled,
    ),
    timestampSessionHeader: readBoolean(
      raw.timestampSessionHeader,
      DEFAULT_PLUGIN_SETTINGS.timestampSessionHeader,
    ),
    timestampSparseIntervalMs: readClampedInteger(
      raw.timestampSparseIntervalMs,
      DEFAULT_PLUGIN_SETTINGS.timestampSparseIntervalMs,
      MIN_TIMESTAMP_SPARSE_INTERVAL_MS,
      MAX_TIMESTAMP_SPARSE_INTERVAL_MS,
    ),
    transcriptFormatting: isTranscriptFormattingMode(raw.transcriptFormatting)
      ? raw.transcriptFormatting
      : DEFAULT_PLUGIN_SETTINGS.transcriptFormatting,
    useLlmNoteContext: readBoolean(
      raw.useLlmNoteContext,
      DEFAULT_PLUGIN_SETTINGS.useLlmNoteContext,
    ),
    useNoteAsContext: readBoolean(raw.useNoteAsContext, DEFAULT_PLUGIN_SETTINGS.useNoteAsContext),
  };
}

export function resetLlmPostprocessDefaults(settings: PluginSettings): PluginSettings {
  return {
    ...settings,
    llmPostprocessActivePresetRef: DEFAULT_PLUGIN_SETTINGS.llmPostprocessActivePresetRef,
    llmPostprocessMode: DEFAULT_PLUGIN_SETTINGS.llmPostprocessMode,
    llmPostprocessNoteContextChars: DEFAULT_PLUGIN_SETTINGS.llmPostprocessNoteContextChars,
    llmPostprocessPriorUtterancesN: DEFAULT_PLUGIN_SETTINGS.llmPostprocessPriorUtterancesN,
    llmPostprocessPrompt: DEFAULT_PLUGIN_SETTINGS.llmPostprocessPrompt,
    llmPostprocessSkipMinWords: DEFAULT_PLUGIN_SETTINGS.llmPostprocessSkipMinWords,
    llmPostprocessTemperature: DEFAULT_PLUGIN_SETTINGS.llmPostprocessTemperature,
    llmPostprocessTotalContextCap: DEFAULT_PLUGIN_SETTINGS.llmPostprocessTotalContextCap,
    useLlmNoteContext: DEFAULT_PLUGIN_SETTINGS.useLlmNoteContext,
  };
}

function readAudioInputDevice(value: unknown): AudioInputDevice | null {
  if (!isRecord(value)) {
    return null;
  }

  const deviceId = typeof value.deviceId === 'string' ? value.deviceId.trim() : '';
  const label = typeof value.label === 'string' ? value.label.trim() : '';

  if (deviceId.length === 0 || label.length === 0) {
    return null;
  }

  return { deviceId, label };
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

function readSetupCompletedAt(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString() === value ? value : null;
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

function readOptionalClampedInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined;
  }
  return Math.min(max, Math.max(min, value));
}

function readOptionalClampedNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(max, Math.max(min, value));
}

function readActivePresetRef(
  value: unknown,
  prompt: string,
  userPresets: readonly LlmUserPreset[],
): string | null {
  if (typeof value === 'string' && resolveStyleOption(value, userPresets) !== null) {
    return value;
  }
  if (value === null) {
    return null;
  }
  return findMatchingStyleRef(prompt, userPresets);
}

function readPrompt(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.trim().length > 0 ? value : fallback;
}

function readLlmPostprocessMode(value: unknown): LlmPostprocessMode {
  if (value !== undefined) {
    return isLlmPostprocessMode(value) ? value : DEFAULT_PLUGIN_SETTINGS.llmPostprocessMode;
  }

  return DEFAULT_PLUGIN_SETTINGS.llmPostprocessMode;
}

function readUserPresets(value: unknown): LlmUserPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const accepted: LlmUserPreset[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    if (accepted.length >= LLM_USER_PRESET_MAX_COUNT) {
      break;
    }

    if (!isRecord(entry)) {
      continue;
    }

    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (id.length === 0 || seenIds.has(id)) {
      continue;
    }

    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (label.length === 0) {
      continue;
    }

    const description = typeof entry.description === 'string' ? entry.description : '';
    const mode = isLlmPresetMode(entry.mode) ? entry.mode : undefined;
    const minWords = readOptionalClampedInteger(entry.minWords, 0, 50);
    const temperature = readOptionalClampedNumber(entry.temperature, 0, 2);

    accepted.push({
      description: description.slice(0, LLM_USER_PRESET_MAX_DESCRIPTION_CHARS),
      id,
      label: label.slice(0, LLM_USER_PRESET_MAX_LABEL_CHARS),
      ...(mode !== undefined ? { mode } : {}),
      ...(minWords !== undefined ? { minWords } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      prompt: readPrompt(entry.prompt, DEFAULT_PLUGIN_SETTINGS.llmPostprocessPrompt),
    });
    seenIds.add(id);
  }

  return accepted;
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

export function isTimestampClock(value: unknown): value is TimestampClock {
  return typeof value === 'string' && (TIMESTAMP_CLOCKS as readonly string[]).includes(value);
}

export function isTimestampDensity(value: unknown): value is TimestampDensity {
  return typeof value === 'string' && (TIMESTAMP_DENSITIES as readonly string[]).includes(value);
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
