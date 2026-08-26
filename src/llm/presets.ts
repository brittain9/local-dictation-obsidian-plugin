import { t } from '../shared/i18n';

export const LLM_POSTPROCESS_MODES = ['off', 'per_utterance', 'batch'] as const;

export type LlmPostprocessMode = (typeof LLM_POSTPROCESS_MODES)[number];

export function isLlmPostprocessMode(value: unknown): value is LlmPostprocessMode {
  return typeof value === 'string' && (LLM_POSTPROCESS_MODES as readonly string[]).includes(value);
}

export type LlmPresetTiming = Exclude<LlmPostprocessMode, 'off'>;

export function isLlmPresetTiming(value: unknown): value is LlmPresetTiming {
  return value === 'per_utterance' || value === 'batch';
}

export const LLM_PRESET_OUTPUTS = ['replace', 'add_above', 'add_below'] as const;

export type LlmPresetOutput = (typeof LLM_PRESET_OUTPUTS)[number];

export function isLlmPresetOutput(value: unknown): value is LlmPresetOutput {
  return typeof value === 'string' && (LLM_PRESET_OUTPUTS as readonly string[]).includes(value);
}

export interface LlmPresetOverrides {
  minWords?: number;
  temperature?: number;
  useNoteContext?: boolean;
}

export interface LlmPreset {
  id: string;
  label: string;
  description?: string;
  prompt: string;
  // undefined = either; presets with add_* output are always 'batch'.
  timing?: LlmPresetTiming;
  output: LlmPresetOutput;
  overrides?: LlmPresetOverrides;
}

export type LlmBuiltinPresetId =
  | 'clean-up'
  | 'professional-writing'
  | 'tldr'
  | 'markdown-formatting'
  | 'action-items';

export interface LlmPresetEntry {
  isBuiltin: boolean;
  preset: LlmPreset;
  ref: string;
}

const CLEAN_UP_PROMPT = t('llm.preset.builtin.cleanUp.prompt');

const PROFESSIONAL_WRITING_PROMPT = t('llm.preset.builtin.professionalWriting.prompt');

const TLDR_PROMPT = t('llm.preset.builtin.tldr.prompt');

const MARKDOWN_FORMATTING_PROMPT = t('llm.preset.builtin.markdownFormatting.prompt');

const ACTION_ITEMS_PROMPT = t('llm.preset.builtin.actionItems.prompt');

export const LLM_BUILTIN_PRESETS = [
  {
    id: 'clean-up',
    label: t('llm.preset.builtin.cleanUp.label'),
    description: t('llm.preset.builtin.cleanUp.description'),
    output: 'replace',
    prompt: CLEAN_UP_PROMPT,
  },
  {
    id: 'professional-writing',
    label: t('llm.preset.builtin.professionalWriting.label'),
    description: t('llm.preset.builtin.professionalWriting.description'),
    output: 'replace',
    prompt: PROFESSIONAL_WRITING_PROMPT,
  },
  {
    id: 'tldr',
    label: t('llm.preset.builtin.tldr.label'),
    description: t('llm.preset.builtin.tldr.description'),
    output: 'add_above',
    prompt: TLDR_PROMPT,
    timing: 'batch',
  },
  {
    id: 'markdown-formatting',
    label: t('llm.preset.builtin.markdownFormatting.label'),
    description: t('llm.preset.builtin.markdownFormatting.description'),
    output: 'replace',
    prompt: MARKDOWN_FORMATTING_PROMPT,
    timing: 'batch',
  },
  {
    id: 'action-items',
    label: t('llm.preset.builtin.actionItems.label'),
    description: t('llm.preset.builtin.actionItems.description'),
    output: 'add_below',
    prompt: ACTION_ITEMS_PROMPT,
    timing: 'batch',
  },
] as const satisfies readonly (LlmPreset & { id: LlmBuiltinPresetId })[];

export const DEFAULT_LLM_BUILTIN_PRESET_ID: LlmBuiltinPresetId = 'clean-up';

export function getLlmBuiltinPreset(id: LlmBuiltinPresetId): LlmPreset {
  const preset = LLM_BUILTIN_PRESETS.find((entry) => entry.id === id);
  if (!preset) {
    throw new Error(`Unknown LLM built-in preset id: ${id}`);
  }
  return preset;
}

export type LlmStyleRef =
  | { kind: 'builtin'; id: LlmBuiltinPresetId }
  | { kind: 'user'; id: string };

const BUILTIN_REF_PREFIX = 'builtin:';
const USER_REF_PREFIX = 'user:';

export function formatStyleRef(ref: LlmStyleRef): string {
  if (ref.kind === 'builtin') {
    return `${BUILTIN_REF_PREFIX}${ref.id}`;
  }
  return `${USER_REF_PREFIX}${ref.id}`;
}

export function parseStyleRef(value: unknown): LlmStyleRef | null {
  if (typeof value !== 'string') {
    return null;
  }

  if (value.startsWith(BUILTIN_REF_PREFIX)) {
    const id = value.slice(BUILTIN_REF_PREFIX.length);
    if (LLM_BUILTIN_PRESETS.some((entry) => entry.id === id)) {
      return { kind: 'builtin', id: id as LlmBuiltinPresetId };
    }
    return null;
  }

  if (value.startsWith(USER_REF_PREFIX)) {
    const id = value.slice(USER_REF_PREFIX.length);
    if (id.length === 0) {
      return null;
    }
    return { kind: 'user', id };
  }

  return null;
}

export function listPresetEntries(userPresets: readonly LlmPreset[]): LlmPresetEntry[] {
  return [
    ...LLM_BUILTIN_PRESETS.map((preset) => ({
      isBuiltin: true,
      preset,
      ref: formatStyleRef({ kind: 'builtin', id: preset.id }),
    })),
    ...userPresets.map((preset) => ({
      isBuiltin: false,
      preset,
      ref: formatStyleRef({ kind: 'user', id: preset.id }),
    })),
  ];
}

export function resolvePresetEntry(
  ref: string | null,
  userPresets: readonly LlmPreset[],
): LlmPresetEntry | null {
  const parsed = parseStyleRef(ref);
  if (parsed === null) {
    return null;
  }
  if (parsed.kind === 'builtin') {
    return {
      isBuiltin: true,
      preset: getLlmBuiltinPreset(parsed.id),
      ref: formatStyleRef(parsed),
    };
  }
  const preset = userPresets.find((entry) => entry.id === parsed.id);
  if (preset === undefined) {
    return null;
  }
  return { isBuiltin: false, preset, ref: formatStyleRef(parsed) };
}

export function resolveActivePresetEntry(
  ref: string | null,
  userPresets: readonly LlmPreset[],
): LlmPresetEntry {
  const resolved = resolvePresetEntry(ref, userPresets);
  if (resolved !== null) {
    return resolved;
  }
  return {
    isBuiltin: true,
    preset: getLlmBuiltinPreset(DEFAULT_LLM_BUILTIN_PRESET_ID),
    ref: formatStyleRef({ kind: 'builtin', id: DEFAULT_LLM_BUILTIN_PRESET_ID }),
  };
}

export interface LlmTransformGlobals {
  minWords: number;
  temperature: number;
  useNoteContext: boolean;
}

// The extension point for future per-preset overrides: add an optional field
// to LlmPresetOverrides and resolve it here; absent fields inherit globals.
export function resolveEffectiveLlmGlobals(
  globals: LlmTransformGlobals,
  preset: LlmPreset,
): LlmTransformGlobals {
  return {
    minWords: preset.overrides?.minWords ?? globals.minWords,
    temperature: preset.overrides?.temperature ?? globals.temperature,
    useNoteContext: preset.overrides?.useNoteContext ?? globals.useNoteContext,
  };
}

export function describePresetTiming(timing: LlmPresetTiming | undefined): string {
  if (timing === 'per_utterance') {
    return t('llm.preset.timing.perUtterance');
  }
  if (timing === 'batch') {
    return t('llm.preset.timing.batch');
  }
  return t('llm.preset.timing.either');
}

export function describePresetBehavior(preset: LlmPreset): string {
  const output =
    preset.output === 'add_above'
      ? t('llm.preset.behavior.addAbove')
      : preset.output === 'add_below'
        ? t('llm.preset.behavior.addBelow')
        : t('llm.preset.behavior.replace');
  const overridden: string[] = [];
  if (preset.overrides?.minWords !== undefined) {
    overridden.push(t('llm.preset.override.minimumWords'));
  }
  if (preset.overrides?.temperature !== undefined) {
    overridden.push(t('llm.preset.override.temperature'));
  }
  if (preset.overrides?.useNoteContext !== undefined) {
    overridden.push(t('llm.preset.override.noteContext'));
  }
  const parts = [describePresetTiming(preset.timing), output];
  if (overridden.length > 0) {
    parts.push(t('llm.preset.behavior.overrides', { fields: overridden.join(', ') }));
  }
  return parts.join(' · ');
}
