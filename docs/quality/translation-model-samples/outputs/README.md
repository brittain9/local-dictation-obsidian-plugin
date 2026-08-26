# Translation model note outputs

These are historical English-to-Dutch outputs from the pre-HY-MT2 PR-head
Markdown pipeline. Bergamot uses the actual installed Firefox Translations
pack. HY-MT uses the official Tencent prompt and recommended decoding
(`temperature=0.7`, `top_k=20`, `top_p=0.6`,
`repeat_penalty=1.05`), fixed seed 42, and synthetic-URL protected markers.
“Topology changed” means that heading levels, list shape, blockquotes, fenced
blocks, task items, or table row/column shape differ from the source. It does
not judge translation quality. Trailing whitespace is normalized in the
committed samples.

MADLAD outputs are absent because its requested GGUF failed the llama.cpp smoke
test before generation, its one permitted fallback produced invalid output, and
the user directed the run to skip it.

| Sample | English source | Bergamot | Historical HY-MT1.5-1.8B Q4_K_M |
| --- | --- | --- | --- |
| 01-release-plan | [source](../source/01-release-plan.md) | [Bergamot](bergamot/01-release-plan.md) | [HY-MT](hy-mt/01-release-plan.md) (topology changed) |
| 02-research-log | [source](../source/02-research-log.md) | [Bergamot](bergamot/02-research-log.md) | [HY-MT](hy-mt/02-research-log.md) (topology changed) |
| 03-team-meeting | [source](../source/03-team-meeting.md) | [Bergamot](bergamot/03-team-meeting.md) | [HY-MT](hy-mt/03-team-meeting.md) (topology changed) |
| 04-garden-journal | [source](../source/04-garden-journal.md) | [Bergamot](bergamot/04-garden-journal.md) | [HY-MT](hy-mt/04-garden-journal.md) (1 source unit kept; topology changed) |
| 05-debugging-diary | [source](../source/05-debugging-diary.md) | [Bergamot](bergamot/05-debugging-diary.md) | [HY-MT](hy-mt/05-debugging-diary.md) |
| 06-reading-notes | [source](../source/06-reading-notes.md) | [Bergamot](bergamot/06-reading-notes.md) | [HY-MT](hy-mt/06-reading-notes.md) (topology changed) |
| 07-trip-plan | [source](../source/07-trip-plan.md) | [Bergamot](bergamot/07-trip-plan.md) | [HY-MT](hy-mt/07-trip-plan.md) (topology changed) |
| 08-finance-review | [source](../source/08-finance-review.md) | [Bergamot](bergamot/08-finance-review.md) (3 source units kept) | [HY-MT](hy-mt/08-finance-review.md) (topology changed) |
| 09-api-design | [source](../source/09-api-design.md) | [Bergamot](bergamot/09-api-design.md) | [HY-MT](hy-mt/09-api-design.md) (topology changed) |
| 10-project-retrospective | [source](../source/10-project-retrospective.md) | [Bergamot](bergamot/10-project-retrospective.md) | [HY-MT](hy-mt/10-project-retrospective.md) |
