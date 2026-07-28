---
title: Debugging diary
component: translation-worker
severity: medium
---

# Debugging diary

Symptom: the preview occasionally fails with “The translation runtime changed protected Markdown slots.” Plain text works. English→Spanish usually works; English→Japanese used to fail more often.

## Reproduction

1. Open [[Marker Regression Note]].
2. Select the line containing `npm run check`, a wikilink, and #release.
3. Run **Translate selection**.
4. Observe whether every marker returns exactly once and in order.

```md
Keep `npm run check`, [[Local Dictation]], #release, and $x + y$ unchanged.
Read [the specification](https://example.com/spec).
```

> [!bug] Important distinction
> A missing marker is not a cosmetic difference. Rebuilding the translated Markdown would put protected content in an unknown location, so the safe behavior is to reject the result before editing.

The original private-use placeholders survived the European language models, but Japanese tokenization dropped them. Synthetic URL markers worked because the vocabulary copied them reliably. The fix should remain pair-aware rather than changing every language to the longer marker form.

## Checks

- [x] Marker count is exact.
- [x] Marker order is stable.
- [x] Duplicate markers fail.
- [x] Missing markers fail.
- [ ] Long note cancellation in the live modal.

The worker must terminate after completion or failure. No partial output should be written, and the captured source revision must still match before Replace is enabled. Related files: `src/translation/markdown-segmentation.ts` and [[Translation Safety Invariants]]. #debugging/translation
