import { randomUUID } from 'node:crypto';

import {
  DEFAULT_LLM_BUILTIN_PRESET_ID,
  formatStyleRef,
  isLlmPostprocessMode,
  isLlmPresetOutput,
  isLlmPresetTiming,
  LLM_BUILTIN_PRESETS,
  type LlmPostprocessMode,
  type LlmPreset,
  type LlmPresetOverrides,
  type LlmPresetTiming,
  listPresetEntries,
  resolveActivePresetEntry,
  resolvePresetEntry,
} from '../llm/presets';
import { isLlmRouting, type LlmProviderModels, type LlmRouting } from '../llm/provider';
import {
  isSelectedModel,
  isSelectedModelCapabilitiesSnapshot,
  normalizeSelectedModel,
  type SelectedModel,
  type SelectedModelCapabilitiesSnapshot,
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

export type TimestampIntervalValidation =
  | { milliseconds: number; valid: true }
  | { message: string; valid: false };

export function validateTimestampIntervalSeconds(value: string): TimestampIntervalValidation {
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  const minSeconds = MIN_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;
  const maxSeconds = MAX_TIMESTAMP_SPARSE_INTERVAL_MS / 1000;

  if (
    !/^\d+$/u.test(trimmed) ||
    !Number.isInteger(seconds) ||
    seconds < minSeconds ||
    seconds > maxSeconds
  ) {
    return {
      message: `Enter a whole number from ${minSeconds} to ${maxSeconds} seconds.`,
      valid: false,
    };
  }

  return { milliseconds: seconds * 1000, valid: true };
}

export const DEFAULT_SMART_PARAGRAPH_PAUSE_MS = 3_000;
export const MIN_SMART_PARAGRAPH_PAUSE_MS = 500;
export const MAX_SMART_PARAGRAPH_PAUSE_MS = 30_000;

export const MIN_DIARIZATION_MAX_SPEAKERS = 1;
export const MAX_DIARIZATION_MAX_SPEAKERS = 8;

export const SPEAKING_STYLES = [
  'responsive',
  'balanced',
  'patient',
] as const satisfies readonly SpeakingStyle[];

export const DEFAULT_LLM_ACTIVE_PRESET_REF = formatStyleRef({
  kind: 'builtin',
  id: DEFAULT_LLM_BUILTIN_PRESET_ID,
});

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

export const DEFAULT_LLM_REMOTE_THRESHOLD_CHARS = 6_000;
export const MIN_LLM_REMOTE_THRESHOLD_CHARS = 500;
export const MAX_LLM_REMOTE_THRESHOLD_CHARS = 60_000;

export const LLM_USER_PRESET_MAX_LABEL_CHARS = 60;
export const LLM_USER_PRESET_MAX_DESCRIPTION_CHARS = 240;
export const LLM_USER_PRESET_MAX_COUNT = 50;

// Shared LLM bounds keep persisted-value normalization and configuration UIs aligned.
// Min words and temperature also apply to per-preset overrides.
export const LLM_MIN_WORDS_MAX = 50;
export const LLM_NOTE_CONTEXT_CHARS_MAX = 12_000;
export const LLM_PRIOR_UTTERANCES_MAX = 5;
export const LLM_TOTAL_CONTEXT_CAP_MAX = 30_000;
export const LLM_TEMPERATURE_MAX = 2;
export const MAX_LLM_REMOTE_TIMEOUT_SEC = 600;
export const MIN_LLM_REMOTE_TIMEOUT_SEC = 5;

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface PluginSettings {
  accelerationPreference: AccelerationPreference;
  audioInputDevice: AudioInputDevice | null;
  includeSystemAudio: boolean;
  cudaLibraryPath: string;
  developerMode: boolean;
  diarizationEnabled: boolean;
  diarizationMaxSpeakers: number | null;
  dictationAnchor: DictationAnchor;
  listeningMode: ListeningMode;
  llmFeaturesEnabled: boolean;
  llmOpenRouterSecretId: string;
  llmRemoteFeaturesEnabled: boolean;
  llmPostprocessActivePresetRef: string;
  // The user's timing choice while the transform is enabled; survives the
  // mode being set to 'off' so re-enabling restores it across restarts.
  llmPostprocessLastEnabledMode: LlmPresetTiming;
  llmPostprocessMode: LlmPostprocessMode;
  llmPostprocessNoteContextChars: number;
  llmPostprocessPriorUtterancesN: number;
  llmPostprocessShowRawBelow: boolean;
  llmPostprocessSkipMinWords: number;
  llmPostprocessTemperature: number;
  llmPostprocessTotalContextCap: number;
  llmPostprocessUserPresets: LlmPreset[];
  llmProviderModels: LlmProviderModels;
  llmRemoteThresholdChars: number;
  llmRemoteTimeoutSec: number;
  llmRouting: LlmRouting;
  localTranscriptSidebarBootstrapped: boolean;
  modelStorePathOverride: string;
  retainLastUtterance: boolean;
  schemaVersion: 2;
  selectedModel: SelectedModel | null;
  // Last-known-good capabilities for `selectedModel`, captured on a successful
  // probe. Lets startup skip re-probing the sidecar (which forces a full
  // model load) when the cached selection still matches.
  selectedModelCapabilitiesSnapshot: SelectedModelCapabilitiesSnapshot | null;
  setupCompletedAt: string | null;
  sidecarPathOverride: string;
  sidecarRequestTimeoutSeconds: number;
  sidecarStartupTimeoutSeconds: number;
  smartParagraphLineBreakPauseMs: number;
  smartParagraphParagraphPauseMs: number;
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
  includeSystemAudio: false,
  cudaLibraryPath: '',
  developerMode: false,
  diarizationEnabled: false,
  diarizationMaxSpeakers: null,
  dictationAnchor: 'at_cursor',
  listeningMode: 'always_on',
  llmFeaturesEnabled: true,
  llmOpenRouterSecretId: '',
  llmRemoteFeaturesEnabled: true,
  llmPostprocessActivePresetRef: DEFAULT_LLM_ACTIVE_PRESET_REF,
  llmPostprocessLastEnabledMode: 'per_utterance',
  llmPostprocessMode: 'off',
  llmPostprocessNoteContextChars: DEFAULT_LLM_POSTPROCESS_CONTEXT.noteContextChars,
  llmPostprocessPriorUtterancesN: DEFAULT_LLM_POSTPROCESS_CONTEXT.priorUtterancesN,
  llmPostprocessShowRawBelow: false,
  llmPostprocessSkipMinWords: DEFAULT_LLM_POSTPROCESS_SKIP.minWords,
  llmPostprocessTemperature: DEFAULT_LLM_POSTPROCESS_GENERATION.temperature,
  llmPostprocessTotalContextCap: DEFAULT_LLM_POSTPROCESS_CONTEXT.totalContextCap,
  llmPostprocessUserPresets: [],
  llmProviderModels: {
    ollama: '',
    openrouter: '',
  },
  llmRemoteThresholdChars: DEFAULT_LLM_REMOTE_THRESHOLD_CHARS,
  llmRemoteTimeoutSec: 60,
  llmRouting: 'local',
  localTranscriptSidebarBootstrapped: false,
  modelStorePathOverride: '',
  retainLastUtterance: true,
  schemaVersion: 2,
  selectedModel: null,
  selectedModelCapabilitiesSnapshot: null,
  setupCompletedAt: null,
  sidecarPathOverride: '',
  sidecarRequestTimeoutSeconds: 300,
  sidecarStartupTimeoutSeconds: 4,
  smartParagraphLineBreakPauseMs: DEFAULT_SMART_PARAGRAPH_PAUSE_MS,
  smartParagraphParagraphPauseMs: DEFAULT_SMART_PARAGRAPH_PAUSE_MS,
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
  const smartParagraphPauses = normalizeSmartParagraphPauseSettings({
    lineBreakPauseMs: raw.smartParagraphLineBreakPauseMs,
    paragraphPauseMs: raw.smartParagraphParagraphPauseMs,
  });
  const { activeRef, userPresets } = migrateLlmPresetState({
    legacyPrompt: raw.llmPostprocessPrompt,
    storedRef: raw.llmPostprocessActivePresetRef,
    userPresets: readUserPresets(raw.llmPostprocessUserPresets),
  });
  const legacyModel =
    typeof raw.llmPostprocessModel === 'string' ? raw.llmPostprocessModel.trim() : '';
  const llmProviderModels = readLlmProviderModels(raw.llmProviderModels, legacyModel);

  return {
    accelerationPreference: readAccelerationPreference(raw.accelerationPreference),
    audioInputDevice: readAudioInputDevice(raw.audioInputDevice),
    includeSystemAudio: readIncludeSystemAudio(raw),
    cudaLibraryPath: readString(raw.cudaLibraryPath, DEFAULT_PLUGIN_SETTINGS.cudaLibraryPath),
    developerMode: readBoolean(raw.developerMode, DEFAULT_PLUGIN_SETTINGS.developerMode),
    diarizationEnabled: readDiarizationEnabled(raw),
    diarizationMaxSpeakers: readDiarizationMaxSpeakers(raw.diarizationMaxSpeakers),
    dictationAnchor: isDictationAnchor(raw.dictationAnchor)
      ? raw.dictationAnchor
      : DEFAULT_PLUGIN_SETTINGS.dictationAnchor,
    listeningMode: readListeningMode(raw.listeningMode),
    llmFeaturesEnabled: readBoolean(
      raw.llmFeaturesEnabled,
      DEFAULT_PLUGIN_SETTINGS.llmFeaturesEnabled,
    ),
    llmOpenRouterSecretId: readSecretId(
      raw.llmOpenRouterSecretId,
      DEFAULT_PLUGIN_SETTINGS.llmOpenRouterSecretId,
    ),
    llmRemoteFeaturesEnabled: readBoolean(
      raw.llmRemoteFeaturesEnabled,
      DEFAULT_PLUGIN_SETTINGS.llmRemoteFeaturesEnabled,
    ),
    llmPostprocessActivePresetRef: activeRef,
    llmPostprocessLastEnabledMode: readLastEnabledMode(
      raw.llmPostprocessLastEnabledMode,
      raw.llmPostprocessMode,
    ),
    llmPostprocessMode: readLlmPostprocessMode(raw.llmPostprocessMode),
    llmPostprocessNoteContextChars: readClampedInteger(
      raw.llmPostprocessNoteContextChars,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessNoteContextChars,
      0,
      LLM_NOTE_CONTEXT_CHARS_MAX,
    ),
    llmPostprocessPriorUtterancesN: readClampedInteger(
      raw.llmPostprocessPriorUtterancesN,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessPriorUtterancesN,
      0,
      LLM_PRIOR_UTTERANCES_MAX,
    ),
    llmPostprocessShowRawBelow: readBoolean(
      raw.llmPostprocessShowRawBelow,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessShowRawBelow,
    ),
    llmPostprocessSkipMinWords: readClampedInteger(
      raw.llmPostprocessSkipMinWords,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessSkipMinWords,
      0,
      LLM_MIN_WORDS_MAX,
    ),
    llmPostprocessTemperature: readClampedNumber(
      raw.llmPostprocessTemperature,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessTemperature,
      0,
      LLM_TEMPERATURE_MAX,
    ),
    llmPostprocessTotalContextCap: readClampedInteger(
      raw.llmPostprocessTotalContextCap,
      DEFAULT_PLUGIN_SETTINGS.llmPostprocessTotalContextCap,
      0,
      LLM_TOTAL_CONTEXT_CAP_MAX,
    ),
    llmPostprocessUserPresets: userPresets,
    llmProviderModels,
    llmRemoteThresholdChars: readClampedInteger(
      raw.llmRemoteThresholdChars,
      DEFAULT_PLUGIN_SETTINGS.llmRemoteThresholdChars,
      MIN_LLM_REMOTE_THRESHOLD_CHARS,
      MAX_LLM_REMOTE_THRESHOLD_CHARS,
    ),
    llmRemoteTimeoutSec: readClampedInteger(
      raw.llmRemoteTimeoutSec,
      DEFAULT_PLUGIN_SETTINGS.llmRemoteTimeoutSec,
      MIN_LLM_REMOTE_TIMEOUT_SEC,
      MAX_LLM_REMOTE_TIMEOUT_SEC,
    ),
    llmRouting: resolveLlmRouting(raw),
    localTranscriptSidebarBootstrapped: readBoolean(
      raw.localTranscriptSidebarBootstrapped,
      DEFAULT_PLUGIN_SETTINGS.localTranscriptSidebarBootstrapped,
    ),
    modelStorePathOverride: readString(
      raw.modelStorePathOverride,
      DEFAULT_PLUGIN_SETTINGS.modelStorePathOverride,
    ),
    retainLastUtterance: readBoolean(
      raw.retainLastUtterance,
      DEFAULT_PLUGIN_SETTINGS.retainLastUtterance,
    ),
    // Bump `schemaVersion` and add a migration step when renaming a key or changing default semantics.
    schemaVersion: 2,
    selectedModel: readSelectedModel(raw.selectedModel),
    selectedModelCapabilitiesSnapshot: readSelectedModelCapabilitiesSnapshot(
      raw.selectedModelCapabilitiesSnapshot,
    ),
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
    smartParagraphLineBreakPauseMs: smartParagraphPauses.lineBreakPauseMs,
    smartParagraphParagraphPauseMs: smartParagraphPauses.paragraphPauseMs,
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

export interface SmartParagraphPauseSettings {
  lineBreakPauseMs: number;
  paragraphPauseMs: number;
}

export function normalizeSmartParagraphPauseSettings(value: {
  lineBreakPauseMs: unknown;
  paragraphPauseMs: unknown;
}): SmartParagraphPauseSettings {
  const paragraphPauseMs = readClampedInteger(
    value.paragraphPauseMs,
    DEFAULT_PLUGIN_SETTINGS.smartParagraphParagraphPauseMs,
    MIN_SMART_PARAGRAPH_PAUSE_MS,
    MAX_SMART_PARAGRAPH_PAUSE_MS,
  );
  const lineBreakPauseMs = readClampedInteger(
    value.lineBreakPauseMs,
    DEFAULT_PLUGIN_SETTINGS.smartParagraphLineBreakPauseMs,
    MIN_SMART_PARAGRAPH_PAUSE_MS,
    MAX_SMART_PARAGRAPH_PAUSE_MS,
  );

  return {
    lineBreakPauseMs: Math.min(lineBreakPauseMs, paragraphPauseMs),
    paragraphPauseMs,
  };
}

export function resetLlmPostprocessDefaults(settings: PluginSettings): PluginSettings {
  return {
    ...settings,
    llmPostprocessLastEnabledMode: 'per_utterance',
    // Resetting configuration must not change whether transformation is enabled.
    llmPostprocessMode:
      settings.llmPostprocessMode === 'off'
        ? 'off'
        : DEFAULT_PLUGIN_SETTINGS.llmPostprocessLastEnabledMode,
    llmPostprocessNoteContextChars: DEFAULT_PLUGIN_SETTINGS.llmPostprocessNoteContextChars,
    llmPostprocessPriorUtterancesN: DEFAULT_PLUGIN_SETTINGS.llmPostprocessPriorUtterancesN,
    llmPostprocessSkipMinWords: DEFAULT_PLUGIN_SETTINGS.llmPostprocessSkipMinWords,
    llmPostprocessTemperature: DEFAULT_PLUGIN_SETTINGS.llmPostprocessTemperature,
    llmPostprocessTotalContextCap: DEFAULT_PLUGIN_SETTINGS.llmPostprocessTotalContextCap,
    useLlmNoteContext: DEFAULT_PLUGIN_SETTINGS.useLlmNoteContext,
  };
}

export function isRemoteLlmEffectivelyEnabled(
  settings: Pick<PluginSettings, 'llmFeaturesEnabled' | 'llmRemoteFeaturesEnabled'>,
): boolean {
  return settings.llmFeaturesEnabled && settings.llmRemoteFeaturesEnabled;
}

export function shouldRefreshLlmSidebar(previous: PluginSettings, next: PluginSettings): boolean {
  return previous.llmRemoteFeaturesEnabled !== next.llmRemoteFeaturesEnabled;
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

function readIncludeSystemAudio(raw: Record<string, unknown>): boolean {
  if (typeof raw.includeSystemAudio === 'boolean') {
    return raw.includeSystemAudio;
  }

  return raw.audioSource === 'system';
}

function readDiarizationEnabled(raw: Record<string, unknown>): boolean {
  if (typeof raw.diarizationEnabled === 'boolean') {
    return raw.diarizationEnabled;
  }

  return readBoolean(raw.speakerLabelsEnabled, DEFAULT_PLUGIN_SETTINGS.diarizationEnabled);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readSecretId(value: unknown, fallback: string): string {
  const id = readString(value, fallback);
  return /^[a-z0-9-]+$/.test(id) ? id : fallback;
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

function readDiarizationMaxSpeakers(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_DIARIZATION_MAX_SPEAKERS ||
    value > MAX_DIARIZATION_MAX_SPEAKERS
  ) {
    return null;
  }
  return value;
}

function readClampedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return readOptionalClampedInteger(value, min, max) ?? fallback;
}

function readClampedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return readOptionalClampedNumber(value, min, max) ?? fallback;
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

// Tolerant reads (schemaVersion stays 1): unknown refs fall back to the default
// preset, and a customized legacy llmPostprocessPrompt becomes a user preset so
// pre-redesign custom prompts survive the removal of the prompt setting.
function migrateLlmPresetState(args: {
  legacyPrompt: unknown;
  storedRef: unknown;
  userPresets: LlmPreset[];
}): { activeRef: string; userPresets: LlmPreset[] } {
  const storedRef = typeof args.storedRef === 'string' ? args.storedRef : null;
  const resolvedRef = resolvePresetEntry(storedRef, args.userPresets)?.ref ?? null;
  const fallbackRef = resolveActivePresetEntry(null, args.userPresets).ref;
  const prompt = typeof args.legacyPrompt === 'string' ? args.legacyPrompt.trim() : '';

  if (prompt.length === 0) {
    return { activeRef: resolvedRef ?? fallbackRef, userPresets: args.userPresets };
  }
  if (resolvedRef !== null) {
    // Pre-redesign code nulled the ref whenever the prompt diverged from the
    // selected preset, so a stored builtin ref is an explicit user choice and
    // the legacy prompt is just a stale mirror of that builtin's old text —
    // trust the ref even when the builtin's prompt changed across versions.
    if (resolvedRef.startsWith('builtin:')) {
      return { activeRef: resolvedRef, userPresets: args.userPresets };
    }
    const active = resolveActivePresetEntry(resolvedRef, args.userPresets);
    if (active.preset.prompt === prompt) {
      return { activeRef: resolvedRef, userPresets: args.userPresets };
    }
  }
  const matching = listPresetEntries(args.userPresets).find(
    (entry) => entry.preset.prompt === prompt,
  );
  if (matching !== undefined) {
    return { activeRef: matching.ref, userPresets: args.userPresets };
  }
  if (args.userPresets.length >= LLM_USER_PRESET_MAX_COUNT) {
    console.warn(
      '[Local Dictation] Custom LLM prompt could not be migrated into a preset: the preset limit is reached. The prompt was dropped.',
    );
    return { activeRef: resolvedRef ?? fallbackRef, userPresets: args.userPresets };
  }
  const labels = new Set(
    [...LLM_BUILTIN_PRESETS, ...args.userPresets].map((preset) => preset.label.toLowerCase()),
  );
  let label = 'My preset';
  for (let n = 2; labels.has(label.toLowerCase()); n += 1) {
    label = `My preset ${n}`;
  }
  const migrated: LlmPreset = { id: randomUUID(), label, output: 'replace', prompt };
  return {
    activeRef: formatStyleRef({ kind: 'user', id: migrated.id }),
    userPresets: [...args.userPresets, migrated],
  };
}

// Seeds from the stored mode for vaults that predate the field, so an
// already-enabled batch user keeps batch on their first disable/enable cycle.
function readLastEnabledMode(value: unknown, storedMode: unknown): LlmPresetTiming {
  if (isLlmPresetTiming(value)) {
    return value;
  }
  if (isLlmPresetTiming(storedMode)) {
    return storedMode;
  }
  return DEFAULT_PLUGIN_SETTINGS.llmPostprocessLastEnabledMode;
}

function readLlmPostprocessMode(value: unknown): LlmPostprocessMode {
  if (value !== undefined) {
    return isLlmPostprocessMode(value) ? value : DEFAULT_PLUGIN_SETTINGS.llmPostprocessMode;
  }

  return DEFAULT_PLUGIN_SETTINGS.llmPostprocessMode;
}

// Resolve routing from a valid `llmRouting`, else map the legacy `llmProvider`
// enum (ollama→local, openrouter→remote, gemini→local since Gemini is gone),
// else fall back to the default. schemaVersion stays 1: these are tolerant reads.
function resolveLlmRouting(raw: Record<string, unknown>): LlmRouting {
  if (isLlmRouting(raw.llmRouting)) {
    return raw.llmRouting;
  }
  switch (raw.llmProvider) {
    case 'ollama':
      return 'local';
    case 'openrouter':
      return 'remote';
    case 'gemini':
      return 'local';
    default:
      return DEFAULT_PLUGIN_SETTINGS.llmRouting;
  }
}

function readLlmProviderModels(value: unknown, legacyOllamaModel: string): LlmProviderModels {
  if (!isRecord(value)) {
    return {
      ...DEFAULT_PLUGIN_SETTINGS.llmProviderModels,
      ollama: legacyOllamaModel,
    };
  }

  return {
    ollama: readString(value.ollama, DEFAULT_PLUGIN_SETTINGS.llmProviderModels.ollama),
    openrouter: readString(value.openrouter, DEFAULT_PLUGIN_SETTINGS.llmProviderModels.openrouter),
  };
}

function readUserPresets(value: unknown): LlmPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const accepted: LlmPreset[] = [];
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

    const prompt =
      typeof entry.prompt === 'string' && entry.prompt.trim().length > 0 ? entry.prompt : null;
    if (prompt === null) {
      continue;
    }

    const description = typeof entry.description === 'string' ? entry.description.trim() : '';
    const output = isLlmPresetOutput(entry.output) ? entry.output : 'replace';
    // Pre-redesign presets stored timing under `mode`.
    const legacyTiming = isLlmPresetTiming(entry.timing)
      ? entry.timing
      : isLlmPresetTiming(entry.mode)
        ? entry.mode
        : undefined;
    const timing = output === 'replace' ? legacyTiming : 'batch';
    // Pre-redesign presets stored minWords/temperature at the top level.
    const overridesRaw = isRecord(entry.overrides) ? entry.overrides : {};
    const minWords = readOptionalClampedInteger(
      overridesRaw.minWords ?? entry.minWords,
      0,
      LLM_MIN_WORDS_MAX,
    );
    const temperature = readOptionalClampedNumber(
      overridesRaw.temperature ?? entry.temperature,
      0,
      LLM_TEMPERATURE_MAX,
    );
    const useNoteContext =
      typeof overridesRaw.useNoteContext === 'boolean' ? overridesRaw.useNoteContext : undefined;
    const overrides: LlmPresetOverrides = {
      ...(minWords !== undefined ? { minWords } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(useNoteContext !== undefined ? { useNoteContext } : {}),
    };

    accepted.push({
      ...(description.length > 0
        ? { description: description.slice(0, LLM_USER_PRESET_MAX_DESCRIPTION_CHARS) }
        : {}),
      id,
      label: label.slice(0, LLM_USER_PRESET_MAX_LABEL_CHARS),
      output,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      prompt,
      ...(timing !== undefined ? { timing } : {}),
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

export { isLlmRouting };

function readSelectedModel(selectedModel: unknown): SelectedModel | null {
  if (isSelectedModel(selectedModel)) {
    return normalizeSelectedModel(selectedModel);
  }

  return DEFAULT_PLUGIN_SETTINGS.selectedModel;
}

function readSelectedModelCapabilitiesSnapshot(
  value: unknown,
): SelectedModelCapabilitiesSnapshot | null {
  if (!isSelectedModelCapabilitiesSnapshot(value)) {
    return DEFAULT_PLUGIN_SETTINGS.selectedModelCapabilitiesSnapshot;
  }

  return {
    capabilities: value.capabilities,
    selection: normalizeSelectedModel(value.selection),
  };
}

function readListeningMode(value: unknown): ListeningMode {
  return isListeningMode(value) ? value : DEFAULT_PLUGIN_SETTINGS.listeningMode;
}
