# Journal Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the approved Faithful and Reflections journal presets in the Local Dictation development vault.

**Architecture:** Modify only the plugin's persisted `data.json`. Preserve every unrelated setting and the current active preset, use stable unique preset IDs, and validate the resulting objects against the application's accepted preset shape.

**Tech Stack:** JSON, PowerShell, Local Dictation settings schema

---

### Task 1: Install And Validate The Presets

**Files:**
- Modify: `C:\Users\alex\Documents\stt-test-vault\.obsidian\plugins\local-dictation\data.json`
- Reference: `docs/superpowers/specs/2026-06-12-journal-presets-design.md`

- [x] **Step 1: Capture the pre-edit settings state**

Read `data.json` and record its `llmPostprocessActivePresetRef`, existing user preset IDs, and top-level property count. Confirm the two journal preset IDs are not already present.

- [x] **Step 2: Add the two preset objects**

Append these objects to `llmPostprocessUserPresets`, replacing objects with the same IDs if this plan is rerun:

```json
{
  "id": "journal-faithful",
  "label": "Journal - Faithful",
  "description": "Turn a dictated journal session into a readable first-person entry without adding interpretation.",
  "prompt": "Rewrite the dictated transcript as a clear, readable first-person journal entry. Preserve the speaker's meaning, emotional tone, uncertainty, chronology, concrete details, names, and distinctive voice. Remove filler words, false starts, accidental repetition, and obvious speech-to-text errors. Improve punctuation and paragraph breaks, but do not make the writing formal or generic. Do not add interpretations, lessons, advice, facts, emotions, certainty, or conclusions that the speaker did not express. If the speaker is conflicted or unsure, preserve that ambiguity. Return only the journal entry with no heading, preamble, commentary, or analysis.",
  "timing": "batch",
  "output": "replace",
  "overrides": {
    "minWords": 4,
    "temperature": 0.2,
    "useNoteContext": false
  }
}
```

```json
{
  "id": "journal-reflections",
  "label": "Journal - Reflections",
  "description": "Keep the journal transcript and add grounded themes, possible connections, and reflective questions below it.",
  "prompt": "Reflect on the dictated journal transcript without rewriting or repeating it. Return a Markdown section beginning with \"## Reflections\". Identify meaningful themes, connections, tensions, emotional patterns, shifts in perspective, unmet needs, assumptions, or recurring concerns that are supported by the transcript. Distinguish direct evidence from interpretation: phrase uncertain insights as possibilities, not facts. Include 2-5 concise bullets under \"### What may be going on\" and 1-3 open-ended questions under \"### Questions to sit with\". Omit a subsection if the transcript does not support it. Do not diagnose mental-health conditions, moralize, give generic encouragement, prescribe actions, or claim to know the speaker better than they know themselves. Return only the Reflections section with no preamble or repetition of the transcript.",
  "timing": "batch",
  "output": "add_below",
  "overrides": {
    "minWords": 15,
    "temperature": 0.65,
    "useNoteContext": false
  }
}
```

- [x] **Step 3: Validate persisted settings**

Parse the edited file as JSON and assert:

- both preset IDs occur exactly once
- both objects match the values above
- `llmPostprocessActivePresetRef` is unchanged
- the top-level property count is unchanged
- all pre-existing user presets remain present

- [x] **Step 4: Report reload requirement**

If Obsidian is running, report that Local Dictation must be reloaded before the in-memory settings reflect the file change. Do not terminate Obsidian or change the active preset.
