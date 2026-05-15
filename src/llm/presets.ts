export const LLM_POSTPROCESS_MODES = ['off', 'per_utterance', 'batch'] as const;

export type LlmPostprocessMode = (typeof LLM_POSTPROCESS_MODES)[number];

export function isLlmPostprocessMode(value: unknown): value is LlmPostprocessMode {
  return typeof value === 'string' && (LLM_POSTPROCESS_MODES as readonly string[]).includes(value);
}

export type LlmPresetMode = Exclude<LlmPostprocessMode, 'off'>;

export function isLlmPresetMode(value: unknown): value is LlmPresetMode {
  return value === 'per_utterance' || value === 'batch';
}

export type LlmBuiltinPresetId =
  | 'clean-up'
  | 'professional-writing'
  | 'tldr'
  | 'markdown-formatting'
  | 'brain-dump'
  | 'voice-commands';

export interface LlmBuiltinPreset {
  id: LlmBuiltinPresetId;
  label: string;
  description: string;
  prompt: string;
  mode?: LlmPresetMode;
}

export interface LlmUserPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
  mode?: LlmPresetMode;
}

export type LlmStyleRef =
  | { kind: 'builtin'; id: LlmBuiltinPresetId }
  | { kind: 'user'; id: string };

export interface LlmStyleOption {
  description: string;
  isBuiltin: boolean;
  label: string;
  mode?: LlmPresetMode;
  prompt: string;
  ref: string;
}

const CLEAN_UP_PROMPT =
  "Clean dictated speech-to-text. Fix filler, false starts, repetitions, punctuation, capitalization, and obvious recognition errors. Preserve the speaker's voice and meaning. Use the reference context only for spelling. Return only the cleaned text — no preamble, no commentary.";

const PROFESSIONAL_WRITING_PROMPT =
  'Rewrite dictated speech as concise professional prose. Active voice, no filler or hedging. Preserve every fact, name, and term. Use the reference context for spelling. Return only the rewritten text — no preamble, no commentary.';

const TLDR_PROMPT =
  "Output a TLDR summary, then a blank line, then the dictated transcript with light cleanup. TLDR: a 'TLDR' heading followed by 1-3 short bullets covering the key points. Light cleanup: fix filler, false starts, punctuation, and capitalization; preserve the speaker's voice and wording — do not rewrite or restructure. Return only the formatted output — no preamble, no commentary.";

const MARKDOWN_FORMATTING_PROMPT =
  "Reformat dictated speech as well-structured Markdown. Add headings, bullet or numbered lists, bold, emphasis, and fenced code blocks where the content calls for it. Lightly clean filler, false starts, punctuation, and capitalization; preserve the speaker's wording, every fact, name, and term. Return only the Markdown — no preamble, no commentary.";

const BRAIN_DUMP_PROMPT =
  "Organize a free-form brain dump into clear structure. Cluster the speaker's points into themes with short headings, and surface action items, open questions, and decisions as separate sections where present. Drop pure filler. Preserve every fact, name, and term. Use the reference context only for spelling. Return only the organized Markdown — no preamble, no commentary.";

const VOICE_COMMANDS_PROMPT =
  "Interpret the dictated transcript as a mix of content and inline instructions to you. When the speaker gives a directive ('make this a list', 'summarize the above', 'rewrite that as a code block', 'remove the last part'), apply it to the surrounding text. Otherwise treat the speech as content to clean lightly. Preserve facts, names, and terms unless the speaker explicitly asks otherwise. Use the reference context only for spelling. Return only the final result — no preamble, no acknowledgment of the directives, no commentary.";

export const LLM_BUILTIN_PRESETS: readonly LlmBuiltinPreset[] = [
  {
    id: 'clean-up',
    label: 'Clean up',
    description:
      'Fix transcription artifacts, filler, punctuation, and capitalization while preserving voice and meaning.',
    prompt: CLEAN_UP_PROMPT,
  },
  {
    id: 'professional-writing',
    label: 'Professional writing',
    description:
      'Rewrite into concise, polished professional prose while preserving facts, names, decisions, and technical terms.',
    prompt: PROFESSIONAL_WRITING_PROMPT,
  },
  {
    id: 'tldr',
    label: 'TLDR + transcript',
    description:
      'Summary at the top, lightly cleaned transcript below. Designed for batch cleanup at the end of a session.',
    mode: 'batch',
    prompt: TLDR_PROMPT,
  },
  {
    id: 'markdown-formatting',
    label: 'Markdown formatting',
    description:
      'Reformat the session transcript as structured Markdown with headings, lists, and emphasis. Batch only.',
    mode: 'batch',
    prompt: MARKDOWN_FORMATTING_PROMPT,
  },
  {
    id: 'brain-dump',
    label: 'Brain dump organizer',
    description:
      'Cluster a rambling brain dump into themes, action items, questions, and decisions. Batch only.',
    mode: 'batch',
    prompt: BRAIN_DUMP_PROMPT,
  },
  {
    id: 'voice-commands',
    label: 'Voice commands (experimental)',
    description:
      'Mix speech with inline directives ("make this a list", "summarize the above") and the model applies them. Batch only, experimental.',
    mode: 'batch',
    prompt: VOICE_COMMANDS_PROMPT,
  },
];

export const DEFAULT_LLM_BUILTIN_PRESET_ID: LlmBuiltinPresetId = 'clean-up';

export function getLlmBuiltinPreset(id: LlmBuiltinPresetId): LlmBuiltinPreset {
  const preset = LLM_BUILTIN_PRESETS.find((entry) => entry.id === id);
  if (!preset) {
    throw new Error(`Unknown LLM built-in preset id: ${id}`);
  }
  return preset;
}

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

export function listStyleOptions(userPresets: readonly LlmUserPreset[]): LlmStyleOption[] {
  const toOption = (
    preset: LlmBuiltinPreset | LlmUserPreset,
    ref: LlmStyleRef,
    isBuiltin: boolean,
  ): LlmStyleOption => ({
    description: preset.description,
    isBuiltin,
    label: preset.label,
    ...(preset.mode !== undefined ? { mode: preset.mode } : {}),
    prompt: preset.prompt,
    ref: formatStyleRef(ref),
  });

  const builtinOptions = LLM_BUILTIN_PRESETS.map((preset) =>
    toOption(preset, { kind: 'builtin', id: preset.id }, true),
  );
  const userOptions = userPresets.map((preset) =>
    toOption(preset, { kind: 'user', id: preset.id }, false),
  );

  return [...builtinOptions, ...userOptions];
}

export function resolveStyleOption(
  ref: string | null,
  userPresets: readonly LlmUserPreset[],
): LlmStyleOption | null {
  if (ref === null) {
    return null;
  }
  return listStyleOptions(userPresets).find((option) => option.ref === ref) ?? null;
}

export function findMatchingStyleRef(
  prompt: string,
  userPresets: readonly LlmUserPreset[],
): string | null {
  for (const option of listStyleOptions(userPresets)) {
    if (option.prompt === prompt) {
      return option.ref;
    }
  }
  return null;
}
