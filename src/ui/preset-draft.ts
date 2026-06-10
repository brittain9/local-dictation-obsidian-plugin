import type {
  LlmPreset,
  LlmPresetOutput,
  LlmPresetOverrides,
  LlmPresetTiming,
} from '../llm/presets';
import {
  LLM_USER_PRESET_MAX_DESCRIPTION_CHARS,
  LLM_USER_PRESET_MAX_LABEL_CHARS,
} from '../settings/plugin-settings';

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
    return { kind: 'error', message: 'Enter a name for this preset.' };
  }
  if (existingLabels.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
    return { kind: 'error', message: 'A preset with that name already exists.' };
  }
  if (draft.prompt.trim().length === 0) {
    return { kind: 'error', message: 'Enter a prompt for this preset.' };
  }

  const minWords = parseOptionalInteger(draft.minWords, 0, 50);
  if (minWords === 'invalid') {
    return { kind: 'error', message: 'Min words must be a whole number between 0 and 50.' };
  }
  const temperature = parseOptionalNumber(draft.temperature, 0, 2);
  if (temperature === 'invalid') {
    return { kind: 'error', message: 'Temperature must be a number between 0 and 2.' };
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

function parseOptionalInteger(
  value: string,
  min: number,
  max: number,
): number | undefined | 'invalid' {
  if (value.trim() === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return 'invalid';
  }
  return parsed;
}

function parseOptionalNumber(
  value: string,
  min: number,
  max: number,
): number | undefined | 'invalid' {
  if (value.trim() === '') {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return 'invalid';
  }
  return parsed;
}
