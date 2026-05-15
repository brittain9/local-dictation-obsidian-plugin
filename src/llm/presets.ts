export type LlmPresetId =
  | 'light-cleanup'
  | 'heavy-cleanup'
  | 'concise-professional'
  | 'creative-writing'
  | 'markdown-structure';

export interface LlmPreset {
  id: LlmPresetId;
  label: string;
  description: string;
  systemSlot: string;
  voiceSlot: string;
  formatSlot: string;
  userTemplate: string;
}

const SHARED_USER_TEMPLATE = `{{glossary}}

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

const LIGHT_CLEANUP_SYSTEM =
  "You clean a single dictated utterance from speech-to-text. Fix disfluencies (um, uh, like, you know), false starts, repetitions, and clear word-recognition errors. Preserve the speaker's voice, word choice, and meaning. Do not summarize, restructure, expand, or add information. Use the reference context only to disambiguate spelling and terminology. Return only the cleaned utterance — no preamble, no quotes, no commentary.";

const HEAVY_CLEANUP_SYSTEM =
  "You clean a single dictated utterance for written prose. Fix grammar, punctuation, capitalization, sentence boundaries, word choice, and pacing. Drop filler aggressively. Merge run-on fragments and split mashed-together sentences so the result reads as polished writing. Preserve the speaker's meaning and any technical terms. Use the reference context for spelling and continuity. Return only the cleaned utterance — no preamble, no quotes, no commentary.";

const CONCISE_PROFESSIONAL_SYSTEM =
  'You rewrite a single dictated utterance into concise professional prose. Strip filler, redundancy, conversational hedging, and self-corrections. Use direct active voice. Preserve every fact, decision, name, and technical term — do not change meaning. Use the reference context for spelling and continuity. Return only the cleaned utterance — no preamble, no quotes, no commentary.';

const CONCISE_PROFESSIONAL_VOICE =
  "Tone: professional, direct, neutral. Avoid 'I think', 'I guess', 'I mean', 'kind of', 'sort of', 'basically' unless they carry real meaning.";

const CREATIVE_WRITING_SYSTEM =
  "You polish a single dictated utterance for a creative-writing note. Fix only obvious transcription errors and disfluencies. Preserve voice, rhythm, imagery, and unconventional phrasing. Resist tightening — keep sentence variety and the speaker's natural cadence. Use the reference context for spelling and continuity. Return only the polished utterance — no preamble, no quotes, no commentary.";

const CREATIVE_WRITING_VOICE =
  "Tone: literary, expressive, faithful to the speaker's cadence. Preserve deliberate fragments, repetitions for effect, and stylistic choices.";

const MARKDOWN_STRUCTURE_SYSTEM =
  'You clean a single dictated utterance for an Obsidian note and lightly format it with markdown. Fix disfluencies and obvious errors as you would in a light cleanup. When the speaker clearly starts a new topic, prefix the result with a markdown header (## Topic). When the speaker lists items, format as a markdown bullet list. Wrap words the speaker visibly emphasizes in **bold**. Do not add structure the speaker did not imply. Return only the cleaned utterance with optional markdown — no preamble, no quotes, no commentary.';

const MARKDOWN_STRUCTURE_FORMAT =
  'Output rules: Markdown allowed. Headers: `## Topic`. Bullets: `- item`. Bold: `**word**`. Do not over-format. Do not add a header for short utterances. Do not wrap the entire output in a code block.';

export const LLM_PRESETS: readonly LlmPreset[] = [
  {
    id: 'light-cleanup',
    label: 'Light cleanup',
    description:
      'Fix disfluencies, repetitions, and obvious transcription errors. Preserve voice and meaning.',
    systemSlot: LIGHT_CLEANUP_SYSTEM,
    voiceSlot: '',
    formatSlot: '',
    userTemplate: SHARED_USER_TEMPLATE,
  },
  {
    id: 'heavy-cleanup',
    label: 'Heavy cleanup',
    description:
      'Fix grammar, punctuation, and sentence structure. Drop filler aggressively. Output reads as polished prose.',
    systemSlot: HEAVY_CLEANUP_SYSTEM,
    voiceSlot: '',
    formatSlot: '',
    userTemplate: SHARED_USER_TEMPLATE,
  },
  {
    id: 'concise-professional',
    label: 'Concise / professional',
    description:
      'Rewrite into concise professional prose. Strip hedging and filler. Preserve all facts and decisions.',
    systemSlot: CONCISE_PROFESSIONAL_SYSTEM,
    voiceSlot: CONCISE_PROFESSIONAL_VOICE,
    formatSlot: '',
    userTemplate: SHARED_USER_TEMPLATE,
  },
  {
    id: 'creative-writing',
    label: 'Creative writing',
    description:
      'Polish for a creative note. Preserve voice, rhythm, and imagery. Fix only obvious errors.',
    systemSlot: CREATIVE_WRITING_SYSTEM,
    voiceSlot: CREATIVE_WRITING_VOICE,
    formatSlot: '',
    userTemplate: SHARED_USER_TEMPLATE,
  },
  {
    id: 'markdown-structure',
    label: 'Markdown structure',
    description:
      'Light cleanup plus markdown when implied: headers for new topics, bullets for lists, bold for emphasis.',
    systemSlot: MARKDOWN_STRUCTURE_SYSTEM,
    voiceSlot: '',
    formatSlot: MARKDOWN_STRUCTURE_FORMAT,
    userTemplate: SHARED_USER_TEMPLATE,
  },
];

export const DEFAULT_LLM_PRESET_ID: LlmPresetId = 'light-cleanup';

export function getLlmPreset(id: LlmPresetId): LlmPreset {
  const preset = LLM_PRESETS.find((entry) => entry.id === id);
  if (!preset) {
    throw new Error(`Unknown LLM preset id: ${id}`);
  }
  return preset;
}
