export type LlmBuiltinPresetId = 'clean-up' | 'professional-writing';

export interface LlmBuiltinPreset {
  id: LlmBuiltinPresetId;
  label: string;
  description: string;
  prompt: string;
}

export interface LlmUserPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export type LlmStyleRef =
  | { kind: 'builtin'; id: LlmBuiltinPresetId }
  | { kind: 'user'; id: string };

export interface LlmStyleOption {
  description: string;
  isBuiltin: boolean;
  label: string;
  prompt: string;
  ref: string;
}

const CLEAN_UP_PROMPT =
  "Clean dictated speech-to-text. Fix filler, false starts, repetitions, punctuation, capitalization, and obvious recognition errors. Preserve the speaker's voice and meaning. Use the reference context only for spelling. Return only the cleaned text — no preamble, no commentary.";

const PROFESSIONAL_WRITING_PROMPT =
  'Rewrite dictated speech as concise professional prose. Active voice, no filler or hedging. Preserve every fact, name, and term. Use the reference context for spelling. Return only the rewritten text — no preamble, no commentary.';

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
  const builtinOptions = LLM_BUILTIN_PRESETS.map(
    (preset): LlmStyleOption => ({
      description: preset.description,
      isBuiltin: true,
      label: preset.label,
      prompt: preset.prompt,
      ref: formatStyleRef({ kind: 'builtin', id: preset.id }),
    }),
  );

  const userOptions = userPresets.map(
    (preset): LlmStyleOption => ({
      description: preset.description,
      isBuiltin: false,
      label: preset.label,
      prompt: preset.prompt,
      ref: formatStyleRef({ kind: 'user', id: preset.id }),
    }),
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
