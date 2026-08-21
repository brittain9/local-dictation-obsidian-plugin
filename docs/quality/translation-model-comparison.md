# Optional local translation engine benchmark

Date: 2026-07-27

Branch benchmarked: `agent/spec-local-translation` at `513dc0b`

Hardware: 16 GB MacBook Pro (Mac14,9), M2 Pro, 12 CPU cores, 19 GPU cores

Runtime: llama.cpp `91f8c9c`, Metal, macOS 26.5.2

## Decision

**Keep Bergamot as the only production translation engine for now.** Neither
candidate passes the requested shipping gates.

HY-MT1.5-1.8B is technically viable and demonstrates a genuinely different
kind of translation: it is more willing to paraphrase and often sounds less
literal. That is a potentially useful optional product mode, not something a
single reference score captures well. This particular Q4 model should still
not be shipped:

- it misses the required `+0.02` COMET gain in both English↔Dutch directions;
- it corrupts table topology in 8 of the 10 realistic notes;
- several fluent-looking Dutch passages change meaning or terminology;
- its license excludes use and distribution in the EU, UK, and South Korea.

MADLAD was disqualified at the viability gate. The requested GGUF aborted
before producing output in current llama.cpp, and the one allowed
Transformers/MPS fallback produced invalid numeric output. The owner then
directed the run to skip further MADLAD work.

The product idea remains sound: retain a **fast, literal** Bergamot mode and
continue evaluating a **natural, paraphrastic** sidecar mode. A future
candidate needs a permissive/global license and a structure-safe translation
pipeline before it is exposed to users.

### Production reassessment (2026-08-21)

The benchmark above remains the quality record; HY-MT is not a quality upgrade
over Bergamot. The production implementation instead treats it as an optional,
more paraphrastic behavior choice for language pairs Fast does not cover. It
translates parsed prose units and table cells, rejects unsafe reconstruction,
keeps preview mandatory, and never silently replaces source text.

Speech Kit does not redistribute the model. Its installer downloads the pinned
artifact directly from Tencent only after the user opens the upstream license
and explicitly confirms that they are outside the European Union, United
Kingdom, and South Korea and accept the terms. This is a restricted opt-in
catalog entry, not the unrestricted global distribution rejected by the
2026-07-27 gate.

## How the comparison was judged

There is no honest one-number answer because the engines offer different
translation experiences.

1. **Reference adequacy:** COMET (`Unbabel/wmt22-comet-da`) on the first 200
   FLORES-200 devtest sentences per direction. COMET is the primary semantic
   reference metric and is comparable to the earlier Bergamot runs.
2. **Reference wording:** chrF++ (`word_order=2`). This rewards character and
   word n-gram overlap, so it is more sensitive to literal wording.
3. **Product behavior:** ten 200–600 word Obsidian-style notes, reviewed for
   fluency, faithfulness, terminology, locale, Markdown survival, and
   end-to-end latency.
4. **Structure audit:** heading levels, list shape, blockquotes, fenced blocks,
   task items, and table row/column topology were compared with the source.

COMET can reward a valid paraphrase; chrF++ can penalize it for differing from
the one reference. FLORES is mostly news prose and does not represent
fragmentary notes or Markdown. The note corpus therefore matters even when
the automatic scores are close. A native-speaker review is still required
before making language-specific quality claims.

FLORES came from the ungated `yash9439/flores200` mirror at revision
`3c6628a4571f383d029d6e897a89ac953ae756d3`. The `devtest.parquet` SHA-256 was
`37ad265e6b77e529fcd4078250979493323678fe4f064f1115a9776c903f15ad`.

## Model viability and exact configuration

Primary-source prompt, architecture, runtime, artifact, access, and license
details are recorded in
[translation-model-source-research.md](translation-model-source-research.md).

| Candidate | Anonymous access | Runtime result | Quantized size | Outcome |
| --- | --- | --- | ---: | --- |
| Tencent HY-MT1.5-1.8B Q4_K_M | one-byte anonymous GET: HTTP 206 | llama.cpp + Metal works | 1,133,080,512 bytes (1.06 GiB) | benchmarked |
| MADLAD-400-3B-MT Q4_K_M | one-byte anonymous GET: HTTP 206 | llama.cpp assertion before generation | 1,858,124,864 bytes (1.73 GiB) | disqualified |

HY-MT SHA-256:
`4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7`.

The HY-MT server configuration used for the decision runs was:

```sh
llama-server \
  -m HY-MT1.5-1.8B-Q4_K_M.gguf \
  -ngl all -c 4096 -np 1 \
  --host 127.0.0.1 --port 18080 --no-webui
```

Every non-Chinese request used Tencent's documented prompt:

```text
Translate the following segment into {target_language}, without additional explanation.

{source_text}
```

The initial task requested greedy decoding. At the owner's later direction,
the primary comparison was rerun with Tencent's recommended settings:

```text
temperature=0.7
top_k=20
top_p=0.6
repeat_penalty=1.05
seed=42
```

The embedded Hunyuan chat template was applied once by llama.cpp. No extra
system prompt or hand-written control tokens were added.

### Sanity gate

Source: `The meeting is scheduled for next Tuesday afternoon.`

| Run | Output |
| --- | --- |
| HY-MT, English→Spanish, recommended | `La reunión está programada para la tarde del próximo martes.` |
| HY-MT, English→Dutch, recommended | `De vergadering wordt gepland voor de volgende tweede dinsdagmiddag.` |
| HY-MT, English→Dutch, greedy diagnostic | `De vergadering is gepland voor de volgende tweede woensdagmiddag.` |

The official sampling recipe corrected the greedy run's Tuesday→Wednesday
error, but the Dutch wording remained unnatural. On the 200-sentence
English→Dutch set, greedy scored higher than the recommended recipe
(`0.8717` versus `0.8671` COMET). This is another reason not to infer
faithfulness from one automatic score or one decoding recipe.

### MADLAD failure

The requested GGUF reached current llama.cpp's encoder-decoder path but aborted
before generation with:

```text
GGML_ASSERT(!cross->seq_ids_enc.empty() && "llama_encode must be called first")
```

Current upstream supports T5 in `llama-cli`/libllama, while T5 server support
remains an unmerged upstream change. One Transformers+MPS fallback used the
official `google/madlad400-3b-mt` checkpoint. It downloaded approximately
11.76 GB, peaked at approximately 9.79 GB RSS, and generated a sequence such
as `1999 - 2000 - 2001...` instead of a translation. No MADLAD quality or
speed claims are made.

## FLORES-200 results

Each cell contains the mean over 200 devtest sentences. HY-MT uses the official
sampling recipe above. Bergamot outputs were regenerated through the actual
installed Firefox Translations pack and current PR-head worker; they were not
reimplemented. The current worker translates in batches of eight, so these
numbers differ slightly from the pre-review baseline supplied with the task.

| Direction | Bergamot COMET | HY-MT COMET | HY delta | Bergamot chrF++ | HY-MT chrF++ | HY delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| en→nl | 0.8651 | 0.8671 | +0.0020 | 56.63 | 50.69 | -5.94 |
| nl→en | 0.8690 | 0.8649 | -0.0041 | 58.13 | 53.82 | -4.30 |
| en→es | 0.8534 | 0.8720 | +0.0187 | 54.13 | 53.40 | -0.73 |
| es→en | 0.8601 | 0.8584 | -0.0017 | 55.30 | 53.84 | -1.46 |
| en→ja | 0.9058 | 0.9158 | +0.0101 | 31.75 | 29.99 | -1.76 |
| ja→en | 0.8691 | 0.8709 | +0.0017 | 54.91 | 50.69 | -4.22 |
| en→pt | 0.8892 | 0.8942 | +0.0050 | 70.70 | 62.36 | -8.34 |

HY-MT's best gain is English→Spanish at `+0.0187`, narrowly below the requested
`+0.02` threshold. It loses COMET in Dutch→English and Spanish→English. It
has lower chrF++ in every direction. The combined pattern is consistent with
freer wording, but the losses and qualitative errors mean it cannot be labeled
simply “higher quality.”

## Translation style and realistic notes

The complete source and output corpus is in
[translation-model-samples/outputs/README.md](translation-model-samples/outputs/README.md).

### Initial impression

**Bergamot is literal, terse, and structurally predictable.** Its Dutch can be
stiff or awkward (`zinkend fonds`, `runtime-details`, translated technical
labels), but it usually preserves the proposition and the note's shape.

**HY-MT is expansive and paraphrastic.** It often turns fragments into fuller
sentences and can sound more conversational. It also sometimes “explains” or
reinterprets the source instead of translating it. In Dutch, the extra freedom
did not reliably produce better prose.

Examples from the fixed-seed note run:

- `skip the viewpoint` became a phrase meaning roughly “avoid viewing the
  wonders,” changing a concrete itinerary instruction;
- `English↔Dutch COMET` became `Engels↔Oudhooglandse taal` (Old High German);
- `a fluent model` became `een fluitend model` (a whistling model);
- a `15 seconds or less` table requirement gained commentary claiming that
  500 words was too much for the note;
- API table labels became claims such as artifact integrity being unknown and
  the installer being unavailable.

These are not merely stylistic differences. They are faithfulness and
terminology errors wrapped in fluent output. This model would require the
same warning as any machine translation, but a warning alone does not satisfy
the shipping gate.

### Markdown robustness

| Engine | Notes with changed topology | Protected units kept in source |
| --- | ---: | ---: |
| Bergamot | 0 / 10 | 3 units in one note |
| HY-MT | 8 / 10 | 1 unit in one note |

All eight notes containing Markdown tables had their table topology changed by
HY-MT. It commonly put individual cells on separate lines, added bullet-like
content inside tables, or changed cell semantics. The synthetic-URL marker mode
successfully protected links, code, math, and other slots, but it does not stop
a generative model from rewriting unprotected pipe/newline syntax.

The current PR's partial-failure recovery kept invalid units in the source
language instead of discarding the whole note. That explains the source-unit
counts and is safer than silent corruption. It does not detect HY-MT's table
rewrites when all protected markers remain present.

## Speed and resources

The Mac was on AC power, charging from 42% to 44%, with 80.7% CPU idle
immediately before the timed HY-MT runs. The 507-word note was segmented by
the current plugin pipeline into 31 translation units. Each engine was run
three times.

| Engine | 500-word runs | Median | Range | Relative |
| --- | --- | ---: | ---: | ---: |
| Bergamot WASM | 1.935 s, 1.919 s, 1.919 s | 1.919 s | 0.016 s | 1.0× |
| HY-MT, Metal, one slot | 13.874 s, 13.288 s, 13.318 s | 13.318 s | 0.586 s | 6.9× slower |

HY-MT generated at a median of approximately `109.6 tokens/s`. Its process
startup to listening was `0.42 s` with the already-used model in the OS file
cache; a true post-reboot disk-cold start was not measured. The single-slot
server peaked at `1,659,748,352` bytes RSS (1.55 GiB), below the 4 GB gate.
Bergamot peaked at `401,276,928` bytes RSS (383 MiB) in the same note harness.

A four-slot quality server reduced the 507-word note to approximately 11.1
seconds, but peaked above 5 GB RSS. Use a single slot by default on a 16 GB
Mac if this class of model is explored further.

The installed all-language Bergamot pack is approximately 526 MiB. HY-MT adds
a 1.06 GiB GGUF, plus the sidecar/runtime code.

## Portuguese hypothesis

The hypothesis is confirmed for Bergamot: generic `pt` output mixes European
and Brazilian Portuguese.

| English concept | Bergamot | HY-MT |
| --- | --- | --- |
| train | `comboio` (pt-PT) | `trem` (pt-BR) |
| bathroom | `casa de banho` (pt-PT) | `banheiro` (pt-BR) |
| mobile phone | `telemóvel` (pt-PT) | `celular` (pt-BR) |
| suit | `fato` (pt-PT) | `terno` (pt-BR) |
| bus / breakfast / ice cream | Brazilian forms | Brazilian forms |

HY-MT was consistently Brazilian in this ten-sentence probe. Bergamot mixed
the two locales. This is a product-locale problem separate from aggregate
translation quality. The UI/catalog should eventually distinguish `pt-BR`
from `pt-PT`; a generic Portuguese quality score cannot tell the owner that
the dialect sounds wrong.

## Gate decisions

| Gate | Requirement | HY-MT result | Decision |
| --- | --- | --- | --- |
| Quality | `>= +0.02` COMET over Bergamot on en→nl and nl→en | `+0.0020`, `-0.0041` | **fail** |
| Speed | `<= 15 s` warm 500-word note | `13.318 s` median | pass |
| Memory | `<= 4 GB` peak RSS | `1.55 GiB` with one slot | pass |
| Markdown | no more corruption than Bergamot | `8/10` vs `0/10` topology changes | **fail** |
| License/distribution | acceptable optional global catalog entry | territory excludes EU, UK, South Korea | **blocker** |

MADLAD fails before these gates because no valid translation was produced.

## Integration recommendation

If a future natural-translation candidate clears the gates, it should run in
the **Rust sidecar**, while Bergamot should remain in the plugin's isolated
WebAssembly worker.

Recommended shape:

1. Keep the existing controller, preview, replace/insert/copy workflow, and
   cancellation behavior common to both engines.
2. Put prompting, decoding, model lifecycle, and native acceleration behind a
   sidecar translation adapter. Do not expose a localhost llama.cpp server
   without authentication; use the existing sidecar IPC boundary.
3. Lazily load the large model only after an explicit translation request,
   keep one inference slot by default, queue requests, and unload after an idle
   timeout. Installing a speech model or opening Obsidian must not load it.
4. Do not send raw Markdown table rows to a generative model. Parse the note
   into text nodes/table cells, translate only the text payloads, and rebuild
   from the unchanged structure. Validate an AST/topology signature before the
   preview is offered.
5. Present engines as behavior choices, not a linear quality ladder:
   **Fast & literal (Bergamot)** and **Natural / paraphrastic (experimental)**.
   Explain that fluent output can still change dates, negation, quantities,
   terminology, and named entities.
6. Keep preview mandatory for the natural mode. Preserve the current stale-note
   guard, show any units retained in the source language, and never overwrite
   the source silently after validation fails.
7. Record the exact model revision, hash, prompt profile, seed, language locale,
   and license in the catalog. Do not redistribute HY-MT, and require explicit
   territory eligibility confirmation before its direct upstream download.

For future model selection, use a profile rather than a single score:
semantic adequacy (COMET), literal/reference overlap (chrF++), native-speaker
fluency, factual faithfulness, locale/register, Markdown topology, latency,
memory, and license.

## Reproduction

Prepare FLORES slices:

```sh
python scripts/prepare-translation-flores.py \
  --parquet /path/to/flores200/devtest.parquet \
  --output-dir /tmp/flores
```

Run the shipping baseline:

```sh
node scripts/translation-model-benchmark.mjs \
  --model bergamot \
  --direction en-nl \
  --format jsonl \
  --input /tmp/flores/en-nl.jsonl \
  --output /tmp/flores/en-nl.bergamot.jsonl
```

Run HY-MT against a local llama.cpp server:

```sh
node scripts/translation-model-benchmark.mjs \
  --model hy-mt \
  --direction en-nl \
  --format jsonl \
  --decoding tencent-recommended \
  --seed 42 \
  --concurrency 1 \
  --input /tmp/flores/en-nl.jsonl \
  --output /tmp/flores/en-nl.hy-mt.jsonl
```

Score outputs:

```sh
python scripts/score-translation-benchmark.py \
  --result bergamot=/tmp/flores/en-nl.bergamot.jsonl \
  --result hy-mt=/tmp/flores/en-nl.hy-mt.jsonl \
  --output /tmp/flores/en-nl.metrics.json
```

The COMET checkpoint, model revisions, and hashes are recorded above and in
the source-research note.

## Could not verify

- Native-speaker judgments for Dutch, Spanish, Japanese, and Portuguese.
- True post-reboot disk-cold startup; the measured startup was process-cold but
  file-cache-warm.
- Performance or quality on Intel Macs, Windows, Linux, CUDA, or CPU-only
  sidecars.
- More than one fixed sampling seed for the full corpus.
- A working MADLAD runtime beyond the one required llama.cpp attempt and one
  permitted fallback.
- Whether Tencent would grant licensing suitable for a globally available
  Obsidian plugin. The license finding is a product risk assessment, not legal
  advice.
