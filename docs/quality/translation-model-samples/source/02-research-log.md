---
title: Research log
date: 2026-07-27
aliases:
  - experiment notes
---

# Research log: fragment handling

Question: does the larger model improve translations because it understands the document, or because it is simply better at isolated fragments?

## Observations

- Headings arrive without the paragraph below them.
- Each bullet is translated as a separate unit.
  - Nested bullets lose the context supplied by their parent.
  - Very short labels such as “Blocked” or “Next” are ambiguous.
- Table cells may contain nouns rather than sentences.
- A callout title can look like a command.

> [!question] Possible confound
> The plugin currently segments per line. A model that performs well on fragments may win even if its long-context translation is not better.

Examples collected from [[Release Notes]]:

| Source fragment | Intended sense |
| --- | --- |
| Ready | installation state |
| Remove | button label |
| Current | selected model |
| Charge | battery behavior, not a price |

The phrase `model is cold` describes an unloaded inference process. It should not become a sentence about temperature. Likewise, $t_{load} + t_{decode}$ is a formula and must remain byte-for-byte unchanged.

```text
Input:  "No model selected"
Risk:   translating "model" as a fashion model
Signal: settings-screen context is absent
```

Next experiment:

1. Translate each line independently through both engines.
2. Translate the same material as one paragraph.
3. Compare terminology, pronouns, and omitted subjects.
4. Check whether preserving the heading as context changes the result.

Conclusion so far: an apparent model-quality problem may really be a segmentation-policy problem. Keep that finding separate from general fluency. #research/translation
