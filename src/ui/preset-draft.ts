import { randomUUID } from 'node:crypto';

import {
  LLM_BUILTIN_PRESETS,
  type LlmPreset,
  type LlmPresetOutput,
  type LlmPresetOverrides,
  type LlmPresetTiming,
} from '../llm/presets';
import type { LlmPresetState } from '../settings/llm-preset-state';
import {
  LLM_MIN_WORDS_MAX,
  LLM_TEMPERATURE_MAX,
  LLM_USER_PRESET_MAX_COUNT,
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
} from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import { type BoundedNumberOptions, validateBoundedNumber } from './validated-number-setting';

export interface LlmPresetDraft {
  description: string;
  label: string;
  // Raw input strings so the editor can hold partially typed values;
  // empty string means "inherit the global setting".
  minWords: string;
  output: LlmPresetOutput;
  prompt: string;
  temperature: string;
  timing: 'either' | LlmPresetTiming;
  useNoteContext: 'inherit' | 'on' | 'off';
}

export interface DuplicateLabelCopy {
  readonly copy: string;
  readonly numberedCopy: (number: number) => string;
}

export type PresetDraftResult =
  | { kind: 'ok'; preset: Omit<LlmPreset, 'id'> }
  | { kind: 'error'; message: string };

export function emptyPresetDraft(): LlmPresetDraft {
  return {
    description: '',
    label: '',
    minWords: '',
    output: 'replace',
    prompt: '',
    temperature: '',
    timing: 'either',
    useNoteContext: 'inherit',
  };
}

// Pick the first free "Base (copy)" / "Base (copy N)" name. Duplicating a
// copy numbers up from its base instead of stacking suffixes. The base label
// is truncated first so the suffix survives the length cap; slicing
// afterwards would silently reproduce an existing name.
export function duplicateLabel(
  label: string,
  existingLabels: readonly string[],
  copy: DuplicateLabelCopy = localizedDuplicateLabelCopy(),
): string {
  const taken = new Set(existingLabels.map((existing) => existing.trim().toLowerCase()));
  const base = label.replace(duplicateSuffixPattern(copy), '');
  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1 ? copy.copy : copy.numberedCopy(attempt);
    const candidate = `${base.slice(0, LLM_USER_PRESET_MAX_LABEL_CHARS - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

function localizedDuplicateLabelCopy(): DuplicateLabelCopy {
  return {
    copy: t('llm.preset.copySuffix'),
    numberedCopy: (number) => t('llm.preset.copySuffixNumbered', { number }),
  };
}

function duplicateSuffixPattern(copy: DuplicateLabelCopy): RegExp {
  const sentinel = 987654321;
  const numberedPattern = escapeRegExp(copy.numberedCopy(sentinel)).replace(
    String(sentinel),
    '\\d+',
  );
  // Preset labels persist when Obsidian's UI locale changes. Keep recognizing
  // the English source suffix as well as the active locale so an existing
  // "(copy)" label does not start stacking translated suffixes.
  const englishPattern = String.raw` \(copy(?: \d+)?\)`;
  return new RegExp(`(?:${escapeRegExp(copy.copy)}|${numberedPattern}|${englishPattern})$`, 'iu');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function draftFromPreset(preset: LlmPreset): LlmPresetDraft {
  return {
    description: preset.description ?? '',
    label: preset.label,
    minWords: preset.overrides?.minWords !== undefined ? String(preset.overrides.minWords) : '',
    output: preset.output,
    prompt: preset.prompt,
    temperature:
      preset.overrides?.temperature !== undefined ? String(preset.overrides.temperature) : '',
    timing: preset.timing ?? 'either',
    useNoteContext:
      preset.overrides?.useNoteContext === undefined
        ? 'inherit'
        : preset.overrides.useNoteContext
          ? 'on'
          : 'off',
  };
}

// `existingLabels` must exclude the preset being edited.
export function validatePresetDraft(
  draft: LlmPresetDraft,
  existingLabels: readonly string[],
): PresetDraftResult {
  const label = draft.label.trim().slice(0, LLM_USER_PRESET_MAX_LABEL_CHARS);
  if (label.length === 0) {
    return { kind: 'error', message: t('llm.preset.validation.nameRequired') };
  }
  if (existingLabels.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
    return { kind: 'error', message: t('llm.preset.validation.nameExists') };
  }
  if (draft.prompt.trim().length === 0) {
    return { kind: 'error', message: t('llm.preset.validation.promptRequired') };
  }

  const minWords = parseOptionalBoundedNumber(draft.minWords, {
    integer: true,
    max: LLM_MIN_WORDS_MAX,
    min: 0,
  });
  if (minWords === 'invalid') {
    return {
      kind: 'error',
      message: t('llm.preset.validation.minimumWords', { max: LLM_MIN_WORDS_MAX }),
    };
  }
  const temperature = parseOptionalBoundedNumber(draft.temperature, {
    max: LLM_TEMPERATURE_MAX,
    min: 0,
  });
  if (temperature === 'invalid') {
    return {
      kind: 'error',
      message: t('llm.preset.validation.temperature', { max: LLM_TEMPERATURE_MAX }),
    };
  }

  const timing: LlmPresetTiming | undefined =
    draft.output !== 'replace' ? 'batch' : draft.timing === 'either' ? undefined : draft.timing;
  const overrides: LlmPresetOverrides = {
    ...(minWords !== undefined ? { minWords } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(draft.useNoteContext !== 'inherit'
      ? { useNoteContext: draft.useNoteContext === 'on' }
      : {}),
  };
  const description = draft.description.trim().slice(0, LLM_USER_PRESET_MAX_DESCRIPTION_CHARS);

  return {
    kind: 'ok',
    preset: {
      ...(description.length > 0 ? { description } : {}),
      label,
      output: draft.output,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      prompt: draft.prompt,
      ...(timing !== undefined ? { timing } : {}),
    },
  };
}

export const MAX_PRESETS_MESSAGE = t('llm.preset.validation.maximumCount', {
  max: LLM_USER_PRESET_MAX_COUNT,
});

export interface PresetSaveOutcome {
  error: string | null;
  state: LlmPresetState;
}

// The save contract for the preset editor: editing updates the preset in
// place; if the edited preset no longer exists (deleted in another window),
// the edits are saved back under the same id rather than dropped; name
// collisions with built-ins or other user presets are rejected.
export function applyPresetDraftSave(
  state: Readonly<LlmPresetState>,
  draft: LlmPresetDraft,
  editedId: string | null,
): PresetSaveOutcome {
  const label = draft.label.trim().toLowerCase();
  if (LLM_BUILTIN_PRESETS.some((preset) => preset.label.toLowerCase() === label)) {
    return {
      error: t('llm.preset.validation.builtinName'),
      state,
    };
  }

  const existingLabels = state.userPresets
    .filter((preset) => preset.id !== editedId)
    .map((preset) => preset.label);
  const result = validatePresetDraft(draft, existingLabels);
  if (result.kind === 'error') {
    return { error: result.message, state };
  }

  if (editedId !== null && state.userPresets.some((preset) => preset.id === editedId)) {
    return {
      error: null,
      state: {
        ...state,
        userPresets: state.userPresets.map((preset) =>
          preset.id === editedId ? { ...result.preset, id: editedId } : preset,
        ),
      },
    };
  }

  if (state.userPresets.length >= LLM_USER_PRESET_MAX_COUNT) {
    return { error: MAX_PRESETS_MESSAGE, state };
  }
  return {
    error: null,
    state: {
      ...state,
      userPresets: [...state.userPresets, { ...result.preset, id: editedId ?? randomUUID() }],
    },
  };
}

function parseOptionalBoundedNumber(
  value: string,
  options: BoundedNumberOptions,
): number | undefined | 'invalid' {
  if (value.trim() === '') {
    return undefined;
  }
  const validation = validateBoundedNumber(value, options);
  return validation.valid ? validation.value : 'invalid';
}
