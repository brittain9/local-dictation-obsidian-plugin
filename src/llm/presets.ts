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

const PRESERVE_TRANSCRIPT_LANGUAGE =
  'Write in the transcript’s original language. Never translate unless the user explicitly asks for translation.';

const CLEAN_UP_PROMPT = `Clean dictated speech-to-text. Fix filler, false starts, repetitions, punctuation, capitalization, and obvious recognition errors. Preserve the speaker's voice and meaning. Use the reference context only for spelling. ${PRESERVE_TRANSCRIPT_LANGUAGE} Return only the cleaned text — no preamble, no commentary.`;

const PROFESSIONAL_WRITING_PROMPT = `Rewrite dictated speech as concise professional prose. Active voice, no filler or hedging. Preserve every fact, name, and term. Use the reference context for spelling. ${PRESERVE_TRANSCRIPT_LANGUAGE} Return only the rewritten text — no preamble, no commentary.`;

const TLDR_PROMPT = `Write a TLDR summary of the dictated transcript: a 'TLDR' heading followed by 1-3 short bullets covering the key points. ${PRESERVE_TRANSCRIPT_LANGUAGE} Return only the heading and bullets — do not repeat the transcript, no preamble, no commentary.`;

const MARKDOWN_FORMATTING_PROMPT = `Reformat dictated speech as well-structured Markdown. Add headings, bullet or numbered lists, bold, emphasis, and fenced code blocks where the content calls for it. Lightly clean filler, false starts, punctuation, and capitalization; preserve the speaker's wording, every fact, name, and term. ${PRESERVE_TRANSCRIPT_LANGUAGE} Return only the Markdown — no preamble, no commentary.`;

const ACTION_ITEMS_PROMPT = `Extract action items from the dictated transcript. Output an 'Action items' heading followed by a Markdown checklist of concrete tasks, naming an owner when the speaker mentions one. If the transcript contains no action items, return nothing. ${PRESERVE_TRANSCRIPT_LANGUAGE} Return only the heading and checklist — do not repeat the transcript, no preamble, no commentary.`;

export const LLM_BUILTIN_PRESETS = [
  {
    id: 'clean-up',
    label: 'Clean up',
    description:
      'Fix transcription artifacts, filler, punctuation, and capitalization while preserving voice and meaning.',
    output: 'replace',
    prompt: CLEAN_UP_PROMPT,
  },
  {
    id: 'professional-writing',
    label: 'Professional writing',
    description:
      'Rewrite into concise, polished professional prose while preserving facts, names, decisions, and technical terms.',
    output: 'replace',
    prompt: PROFESSIONAL_WRITING_PROMPT,
  },
  {
    id: 'tldr',
    label: 'TLDR',
    description: 'Add a short TLDR summary above your untouched transcript.',
    output: 'add_above',
    prompt: TLDR_PROMPT,
    timing: 'batch',
  },
  {
    id: 'markdown-formatting',
    label: 'Markdown formatting',
    description:
      'Reformat the session transcript as structured Markdown with headings, lists, and emphasis.',
    output: 'replace',
    prompt: MARKDOWN_FORMATTING_PROMPT,
    timing: 'batch',
  },
  {
    id: 'action-items',
    label: 'Action items',
    description: 'Add an action-item checklist below your untouched transcript.',
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
    return 'Runs after each phrase';
  }
  if (timing === 'batch') {
    return 'Runs once on stop';
  }
  return 'Runs in either mode';
}

export function describePresetBehavior(preset: LlmPreset): string {
  const output =
    preset.output === 'add_above'
      ? 'adds new content above the transcript'
      : preset.output === 'add_below'
        ? 'adds new content below the transcript'
        : 'rewrites the dictated text';
  const overridden: string[] = [];
  if (preset.overrides?.minWords !== undefined) {
    overridden.push('min words');
  }
  if (preset.overrides?.temperature !== undefined) {
    overridden.push('temperature');
  }
  if (preset.overrides?.useNoteContext !== undefined) {
    overridden.push('note context');
  }
  const parts = [describePresetTiming(preset.timing), output];
  if (overridden.length > 0) {
    parts.push(`overrides ${overridden.join(', ')}`);
  }
  return parts.join(' · ');
}
