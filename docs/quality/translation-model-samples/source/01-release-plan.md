---
title: Local Translation Release Plan
status: draft
owners:
  - alex
tags:
  - local-dictation
  - release
---

# Local translation release plan

The goal is simple: let someone translate a selection or a complete note without sending text to a remote service. The first release should feel predictable before it feels clever. A user chooses a source language, chooses a target language, reviews a preview, and then decides whether to replace the original text, insert the result below it, or copy it.

> [!important] Release boundary
> Translation must remain optional. Installing a speech model must not silently download a translation model, and opening Obsidian must not load either model into memory.

## What needs to work

- Translate a short paragraph containing ordinary prose.
  - Keep `npm run check` unchanged.
  - Preserve [[Local Dictation]] and [[Model Manager|the model browser]].
  - Leave the destination in [the public guide](https://example.com/guide) untouched.
- Translate a complete note without changing frontmatter.
- Cancel a long request without partially editing the active file.
- Show a useful recovery action when the model is missing.
- Keep tags such as #release/translation and equations such as $E = mc^2$ intact.

The preview is a safety boundary, not decorative UI. Translation systems can change terminology, dates, negation, and named entities while producing very fluent sentences. The Replace button therefore becomes unavailable if the note changes after the preview was created. Copy and Insert below remain available because they do not overwrite the captured source range.

| Gate | Target | Evidence |
| --- | ---: | --- |
| Warm 500-word note | 15 seconds or less | Three local runs |
| Peak memory | 4 GB or less | Process measurement |
| Model integrity | SHA-256 match | Installer metadata |
| Markdown survival | No worse than baseline | Ten-note corpus |

## Open questions

1. Should language names follow the Obsidian interface locale or remain in English?
2. Is automatic source detection useful enough to justify another model?
3. Do we need a terminology list in the first release, or can it wait until real users request it?

```ts
type TranslationDecision =
  | { action: "replace"; expectedRevision: number }
  | { action: "insert-below" }
  | { action: "copy" };
```

The narrow answer is preferable: ship the smallest trustworthy loop, measure where it fails, and avoid treating a fluent preview as proof of semantic accuracy. Follow-up work belongs in [[Translation Backlog]], with the benchmark inputs and outputs attached so that a future model can be tested against the same evidence.

## Before merging

- [ ] Re-run the actual installed model pack.
- [ ] Review English↔Dutch quality with a fluent speaker.
- [ ] Verify Japanese protected markers.
- [ ] Record the model license and distribution constraints.
- [ ] Reopen Obsidian after installing the final bundle.

The owner can accept a slower optional tier, but the product should state the tradeoff plainly: a larger download buys a measurable quality improvement, not merely a different writing style.
