# Journal Presets Design

## Goal

Add two user presets to the Local Dictation development vault:

- **Journal - Faithful** turns a dictated journal session into a readable first-person entry without adding interpretation.
- **Journal - Reflections** preserves the dictated transcript and adds a clearly labeled reflective analysis below it.

These presets are complementary. The user chooses whether a session needs editing or interpretation instead of combining both behaviors into one destructive rewrite.

## Installation

Install both presets as user preset objects in:

`C:\Users\alex\Documents\stt-test-vault\.obsidian\plugins\local-dictation\data.json`

Preserve all existing settings. Add the presets to `llmPostprocessUserPresets` with unique IDs. Do not change the active preset automatically. Reload Local Dictation or restart Obsidian after editing the file so the plugin reads the new settings.

This task does not add a general JSON import feature.

## Preset: Journal - Faithful

### Behavior

- Timing: batch, once after dictation stops
- Output: replace the session transcript
- Minimum words: 4
- Temperature: 0.2
- Note context: off

Low temperature favors a consistent, conservative edit. Disabling note context prevents older writing from influencing the current entry.

### Prompt

```text
Rewrite the dictated transcript as a clear, readable first-person journal entry. Preserve the speaker's meaning, emotional tone, uncertainty, chronology, concrete details, names, and distinctive voice. Remove filler words, false starts, accidental repetition, and obvious speech-to-text errors. Improve punctuation and paragraph breaks, but do not make the writing formal or generic. Do not add interpretations, lessons, advice, facts, emotions, certainty, or conclusions that the speaker did not express. If the speaker is conflicted or unsure, preserve that ambiguity. Return only the journal entry with no heading, preamble, commentary, or analysis.
```

## Preset: Journal - Reflections

### Behavior

- Timing: batch, once after dictation stops
- Output: add below the untouched session transcript
- Minimum words: 15
- Temperature: 0.65
- Note context: off

Moderate temperature allows useful connections without encouraging highly speculative output. The minimum-word gate avoids generating analysis from fragments that lack enough substance.

### Prompt

```text
Reflect on the dictated journal transcript without rewriting or repeating it. Return a Markdown section beginning with "## Reflections". Identify meaningful themes, connections, tensions, emotional patterns, shifts in perspective, unmet needs, assumptions, or recurring concerns that are supported by the transcript. Distinguish direct evidence from interpretation: phrase uncertain insights as possibilities, not facts. Include 2-5 concise bullets under "### What may be going on" and 1-3 open-ended questions under "### Questions to sit with". Omit a subsection if the transcript does not support it. Do not diagnose mental-health conditions, moralize, give generic encouragement, prescribe actions, or claim to know the speaker better than they know themselves. Return only the Reflections section with no preamble or repetition of the transcript.
```

## Validation

1. Load the edited settings through `resolvePluginSettings` and confirm both presets survive normalization unchanged.
2. Confirm the preset manager lists both user presets.
3. Confirm **Journal - Faithful** resolves to batch timing, replace output, temperature `0.2`, minimum words `4`, and note context off.
4. Confirm **Journal - Reflections** resolves to batch timing, add-below output, temperature `0.65`, minimum words `15`, and note context off.
5. Preserve the existing active preset and all unrelated settings.
