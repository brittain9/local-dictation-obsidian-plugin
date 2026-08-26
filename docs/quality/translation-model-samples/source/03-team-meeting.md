---
title: Weekly team meeting
attendees: [Alex, Morgan, Priya]
---

# Weekly team meeting

## Decisions

- Keep the fast Firefox engine as the default.
- Treat any larger model as an optional quality tier.
- Do not advertise “professional translation” without native-speaker review.
- Measure end-to-end note latency rather than quoting only tokens per second.

> [!decision] Download policy
> No repository-gated artifact may appear in the catalog. The installer must be able to fetch every file anonymously and verify its checksum.

## Discussion

Morgan reported that Portuguese output sounded wrong even when the sentence was understandable. The group suspects a dialect mismatch: the model may prefer Brazilian Portuguese while the expected result is European Portuguese. Priya will compare “você” with “tu,” “trem” with “comboio,” and progressive constructions such as “está falando” versus “está a falar.”

Alex showed the current worker timing. Loading the files and starting the worker took less than a second, while a multi-gigabyte decoder had a much larger cold start. Everyone agreed that `tokens/sec` is useful diagnostic data but not the product metric.

| Owner | Follow-up | Due |
| --- | --- | --- |
| Alex | Run English↔Dutch COMET | Tuesday |
| Morgan | Review Portuguese dialect | Wednesday |
| Priya | Inspect Markdown failures | Friday |

## Risks

1. A fluent model may hallucinate a date or reverse a negation.
2. Protected markers may be dropped or reordered.
3. A restrictive license may make global distribution impossible.
4. Low battery power can distort Metal timing.

```bash
node scripts/translation-model-benchmark.mjs \
  --model hy-mt \
  --direction en-nl \
  --input samples.jsonl \
  --output results.jsonl
```

Related: [[Translation Quality]], [[Model Licensing]], and #meeting/local-dictation.
