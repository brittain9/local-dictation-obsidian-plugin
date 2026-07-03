# Spec: Moonshine in the Model Catalog

Status: approved for implementation (handoff to Codex)
Issue: [#177](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/177)
Predecessor: `docs/specs/live-dictation-moonshine.md` (PR #176)

## Product goal

A fresh user can discover, install, select, update, and remove a Moonshine
streaming model entirely through Manage Models — no terminal, no manual
seven-file download, no `external_file` selection. Interrupted or corrupt
downloads can never leave a selectable partial install. Whisper and Cohere
catalog behavior is unchanged.

## Current state (verified 2026-07-03)

Almost all machinery already exists; this PR is mostly catalog data plus one
real bug fix:

- The installer (`native/src/installer.rs:433-723`) already handles
  multi-artifact models: per-install staging dir, streaming SHA-256 + exact
  size verification per file, probe-before-promote, atomic `fs::rename`
  promotion, cleanup of staging on failure/cancel. The Cohere entries (6
  artifacts each) prove it end-to-end.
- `moonshine` is already a first-class `ModelFamilyId` in Rust
  (`native/src/engine/capabilities.rs:32-53`) and TS
  (`src/models/model-management-types.ts:7`), with
  `supportsStreaming: true` and a "Streaming" capability chip already
  rendered by `buildCapabilityLabels` (`src/models/capability-view.ts:54`).
- The adapter resolves the six sibling files from the primary graph's
  directory (`REQUIRED_SIBLINGS`, `native/src/adapters/moonshine.rs:22-38`),
  which is exactly the layout a managed install produces.
- `engine-moonshine` is already compiled into **every** shipped sidecar:
  `scripts/build-sidecar.mjs:6-9` (all desktop builds) and the CUDA builds
  via the `gpu-ort-cuda` transitive feature (`native/Cargo.toml:39`).
  Packaging needs verification, not work.
- Catalog validation (`native/src/catalog.rs:122-247`) enforces unique ids,
  hex sha256, https URLs, safe relative filenames, and ≥1 required
  `transcription_model` artifact; the `bundled_catalog_is_valid` test will
  cover the new entries automatically.

What is missing: the catalog data itself, a deterministic tab order in
Manage Models, and test-fixture coverage for a third family.

## Out of scope

- Any change to the streaming decode path, worker, or plugin session code
  (that is PR `feat/live-dictation-release-readiness`).
- Multilingual Moonshine models. The non-streaming multilingual `base`
  models are under the **non-commercial Moonshine Community License** — do
  not catalog them.
- Download resume for interrupted installs (restart-from-scratch is the
  existing, accepted behavior).
- Catalog schema changes. `catalogVersion` stays `2`; the additions are
  purely data.

## Model selection rationale

Researched 2026-07-03 (HF model cards, moonshine-ai/moonshine GitHub, CDN
probing):

- **Moonshine v2 streaming is the right family** for this plugin's
  `ort`-on-CPU live path: natively streaming encoder, native casing and
  punctuation, MIT weights, small footprints (51–303 MB), anonymous
  downloads. No Moonshine v3 exists as of July 2026.
- Credible alternatives were evaluated and rejected for now:
  **NVIDIA Parakeet Realtime EOU / TDT 0.6B** (better WER, but CC-BY-4.0,
  600M params ≈ 12× tiny's CPU load, chunked rather than natively
  streaming; the one candidate worth tracking), **sherpa-onnx streaming
  Zipformer** (Apache-2.0, but requires reimplementing transducer decoding
  and kaldi feature extraction on raw `ort`, and lacks native punctuation),
  **Kyutai STT** (no ONNX export, ~1B params). Vosk is not quality-
  competitive in 2026.
- All three official streaming variants ship (quantized int8 only —
  `float/` does not exist on the CDN): published fp32 open-ASR average WER
  is tiny 12.01%, small 7.84%, medium 6.65% (medium beats Whisper Large v3
  with ~6× fewer parameters). We catalog **all three**: tiny for low-end
  CPUs, small as the recommended balance, medium for accuracy.

## Design decisions

### D1 — Three catalog entries, one new family and collection

Add to `native/catalog.json` (schema unchanged):

- Family: `{ familyId: "moonshine", runtimeId: "onnx_runtime",
  displayName: "Moonshine", summary: "Moonshine v2 streaming models for
  live dictation (English, MIT) running on ONNX Runtime." }`
- Collection: `{ collectionId: "moonshine_streaming", displayName:
  "Moonshine Streaming", summary: "English live-dictation models in three
  quality tiers." }`
- Models: `moonshine_tiny_streaming_en`, `moonshine_small_streaming_en`,
  `moonshine_medium_streaming_en` (display names "Moonshine Tiny/Small/
  Medium Streaming"). Suggested guidance content:
  - tiny — `uxTags: ["fast", "cpu"]`; ~51 MB; 34M params; first choice for
    low-end hardware.
  - small — `uxTags: ["balanced", "starter"]`; ~165 MB; 123M params; the
    recommended default (mirror the "starter" convention Whisper uses).
  - medium — `uxTags: ["accuracy"]`; ~303 MB; 245M params; note it beats
    Whisper Large v3 on open-ASR WER.
  - All: `languageTags: ["en"]`; notes must state English-only, live/
    streaming behavior, and the quantized (int8) precision.

### D2 — Artifacts pinned to the Moonshine AI CDN, checksums precomputed

Use the CDN layout (`https://download.moonshine.ai/model/<variant>/quantized/<file>`),
**not** the Hugging Face `UsefulSensors/moonshine-streaming` ONNX tree: the
HF tree ships `tokenizer.json` instead of the `tokenizer.bin` the adapter
requires, adds `decoder.ort`/`ten-vad.onnx`, and its decoder files are ~3×
larger (apparently unquantized). The CDN set is what the official reference
implementation downloads and what PR #176 validated.

Per model, seven artifacts, all `required: true`; `frontend.ort` is the
single `role: "transcription_model"` (it is the entry graph the adapter
receives — `primary_artifact()` resolves it at selection time), the other
six are `supporting_file`. Flat filenames, no subdirectories.

The full pinned table (URL, sha256, sizeBytes for all 21 artifacts) is in
**Appendix A** — checksums were computed 2026-07-03 from fresh CDN
downloads, and sizes match the CDN `Content-Length` exactly. Do not
recompute them from Hugging Face; the files differ between channels.

### D3 — License metadata

All three English streaming variants are **MIT** (verified in
`moonshine-ai/moonshine` LICENSE §1 and the HF model-card `license: mit`
tags; the non-commercial Community License applies only to multilingual
models, which we exclude).

- `licenseLabel: "MIT"`,
  `licenseUrl: "https://github.com/moonshine-ai/moonshine/blob/main/LICENSE"`.
- `sourceUrl: "https://github.com/moonshine-ai/moonshine"`, `modelCardUrl`
  per size: `https://huggingface.co/UsefulSensors/moonshine-streaming-tiny`
  / `-small` / `-medium`.
- **No `THIRD_PARTY_NOTICES.md` entry.** Repo convention scopes that file
  to artifacts embedded in the sidecar binary (Silero, WeSpeaker,
  pyannote); downloaded catalog models carry their license via the catalog
  fields, exactly like Whisper and Cohere.

### D4 — Deterministic Manage Models tab order (root-cause fix)

The reported "tabs change order between opens" bug is a Rust `HashMap`
iteration-order leak: `EngineRegistry::adapters()`
(`native/src/engine/registry.rs:61-63`) iterates
`HashMap::values()`, whose order is randomized per process, and
`build_system_info_event` (`native/src/app.rs:671-680`) collects that order
straight into `compiledAdapters`; `renderTabs()`
(`src/models/manage-models-modal.ts:143-165`) then derives both tab order
and the default active tab (`adapters[0]`) from it. `compiled_runtimes`
(`app.rs:661-669`) has the same defect.

Fix both layers:

1. **Rust (root cause):** sort `compiled_adapters` and `compiled_runtimes`
   by a stable key (`(runtime_id, family_id)` string order is fine) before
   emitting `SystemInfo`, so the wire contract is deterministic. Add a unit
   assertion.
2. **TS (product-controlled order):** order tabs by the position of each
   family in `catalog.families` (a deterministic, product-authored JSON
   array — Whisper, Cohere Transcribe, Moonshine), filtering to compiled
   adapters as today. The catalog, not adapter registration, decides tab
   presentation order; the default active tab becomes stable as a
   consequence.

Update `test/model-install-manager.test.ts:97`, which currently pins a mock
`compiledAdapters` order and hides the bug.

### D5 — Selection UX

Nothing structural. A managed Moonshine model flows through the existing
probe → select path (`resolve_catalog_model_runtime_path` returns the
installed `frontend.ort`; the adapter resolves siblings from the install
dir). The Streaming capability chip already appears in Model Details.
`external_file` selection remains for power users; it is no longer the
normal path. Rewrite `docs/guides/moonshine-live-testing.md`'s download
section to point at Manage Models first, keeping the manual CDN commands as
a developer appendix.

### D6 — CDN mutability risk (accepted, contained)

`download.moonshine.ai` URLs carry no version segment, so upstream could
republish files in place. The pinned sha256s convert that from a silent
behavior change into a hard, user-visible install failure ("checksum
mismatch"), which is the correct failure mode for a privacy-first product.
Remediation when it ever fires: re-verify the new assets manually, then
re-pin checksums in `native/catalog.json` (one-liner per file:
`curl -sL <url> | sha256sum`). Record this in the catalog entry `notes` or
a code comment near the Moonshine entries? No — keep the catalog clean; the
remediation lives in this spec and the PR description.

## Execution plan

1. **Catalog data** — add family, collection, and three models with the
   Appendix A artifact table to `native/catalog.json`. Gate: `cargo test`
   `bundled_catalog_is_valid` passes; the new entries satisfy every
   validation rule.
2. **Deterministic ordering** — Rust sort of `compiled_adapters` /
   `compiled_runtimes` + TS catalog-order tabs (D4), with a Rust unit test
   and an updated/added TS test that fails on unsorted input.
3. **Test fixtures** — extend `test/fixtures/catalog.ts` with the Moonshine
   family and a multi-artifact model builder (mirror the Cohere shape);
   widen the `familyId` union in `test/capability-view.test.ts:41`; add a
   Moonshine catalog-model row/install/select case to
   `test/model-row-state.test.ts` and `test/model-install-manager.test.ts`
   (install lifecycle is family-parameterized via
   `test/fixtures/models.ts:45-52` — extend, don't duplicate).
4. **Docs** — update `docs/guides/moonshine-live-testing.md` per D5.
5. **Verification pass** — see below.

## Verification

- `npm run check` (typecheck, biome, eslint, vitest, frontend build) and
  `npm run check:rust` green.
- `bundled_catalog_is_valid` covers the new entries (confirm it fails if a
  checksum is malformed by temporarily mutating one — then revert).
- **Manual, required before marking ready-for-review:** in Obsidian, from a
  clean model store: install Moonshine Small from Manage Models (watch
  per-file progress "File N of 7"), select it, run a live dictation
  session; cancel a second install mid-download and confirm no partial dir
  remains under the model store and the model stays uninstalled; remove the
  installed model. Verify the tab order is stable across ≥3 plugin
  reloads.
- Real-asset gate (already run during spec authoring, 2026-07-03): all
  three pinned asset sets (tiny/small/medium) decode the repo fixture
  through the real adapter via `MOONSHINE_MODEL_PATH=... cargo test
  --features engine-moonshine --lib
  local_model_decodes_fixture_in_streaming_chunks -- --ignored`. Re-run if
  any pinned URL or checksum changes.

## Risks

- **CDN republish** — handled by D6; failure mode is explicit.
- **Ordering fix regressions** — the mock at
  `test/model-install-manager.test.ts:97` pinned the old arbitrary order;
  step 2's tests must assert the *new* contract, not incidentally encode
  another arbitrary order.
- **Install probe on low-RAM machines** — probe loads the model during
  install (before promotion). Medium (~303 MB quantized) is well within
  the envelope already accepted for Cohere (multi-GB); no action.

## Appendix A — Pinned artifacts (computed 2026-07-03)

Base URL pattern: `https://download.moonshine.ai/model/<variant>/quantized/<filename>`

### moonshine_tiny_streaming_en (variant `tiny-streaming-en`, total 51,131,795 bytes)

| filename | role | sha256 | sizeBytes |
|---|---|---|---|
| frontend.ort | transcription_model | bbdf5edb120cb3df1adf9ebc07c35136539b007a7047fd148c6f2960fc56fcf1 | 8324600 |
| encoder.ort | supporting_file | 96dde726be90c4429f3bc458d04e3ea5bd1818a5fdcd0152edf4c07b8e405c07 | 7569200 |
| adapter.ort | supporting_file | df13e655b29d279911fcb42d8b91b0e655b8fe32b7ba1f463ece663ce55ae6eb | 1319440 |
| cross_kv.ort | supporting_file | 5acfca68f7bb068c68c1960b54e215995ba07ee46b61645b78bff010a14e5a92 | 1264384 |
| decoder_kv.ort | supporting_file | 6e3828f1db4b634bc525cb8ba1f0b628ec56059168f0336ad060891c7c1c9154 | 32403688 |
| streaming_config.json | supporting_file | 74fe5ddebd63b17caf59e8a3b18c17547ff7bce1642050edbb1c3962674f8950 | 509 |
| tokenizer.bin | supporting_file | 6884b35fd6377d4c4d32336a0bc152f36b64d1e45b6503683cdc238250a8472d | 249974 |

### moonshine_small_streaming_en (variant `small-streaming-en`, total 164,689,974 bytes)

| filename | role | sha256 | sizeBytes |
|---|---|---|---|
| frontend.ort | transcription_model | e086451043c1c8652a9614e4a4a81d5807221b611584a3cf31f73779d5900003 | 30984200 |
| encoder.ort | supporting_file | 3b21d02eff6aa5651524ada4271d37c1d7bba4eb3d256415074f2cfdbaeb526a | 43853224 |
| adapter.ort | supporting_file | d8493e0ac76a198b309a8be6f74b3101e235f773ffe5d6b378278cd7e4177992 | 2867424 |
| cross_kv.ort | supporting_file | 6e57d1361717e00d73336a0c3beafedae784b1e537905ad253dee33db4007466 | 5298736 |
| decoder_kv.ort | supporting_file | d5adfcfaa6e582144791f1568bd0f683852c7bfbb8c79acad97499da05e4ffcf | 81435904 |
| streaming_config.json | supporting_file | 26f02b6afb22d60871a5efd85c3d38e569cc0ddb6c5eb6e93d3260152ae8a47a | 512 |
| tokenizer.bin | supporting_file | 6884b35fd6377d4c4d32336a0bc152f36b64d1e45b6503683cdc238250a8472d | 249974 |

### moonshine_medium_streaming_en (variant `medium-streaming-en`, total 303,329,727 bytes)

| filename | role | sha256 | sizeBytes |
|---|---|---|---|
| frontend.ort | transcription_model | 378fe8a5d7090a1b9ab88bbb1fc95bde010cdd64ec23419350d2d23c675636e9 | 47467256 |
| encoder.ort | supporting_file | a5f11167a62eef61787fe8410453257d6ddb8eba90af461a9604e5f2e93d5322 | 94202872 |
| adapter.ort | supporting_file | 16307442b7f4229f2f1511fc51b545cec9616e55872c588f3a297bbc6f4762ea | 3647712 |
| cross_kv.ort | supporting_file | 354b9a955caeb768b528f447f0a36ce4b850ca7b4531900165df304d97904fba | 11544952 |
| decoder_kv.ort | supporting_file | fa67aa87521247f5bf44d3e44d4e4978e58c1f114249c3c6909c882624056715 | 146216448 |
| streaming_config.json | supporting_file | 28e83b7a28e91472692a035e0dae3116422ae43aeb2bef5ed822c44ce89b88af | 513 |
| tokenizer.bin | supporting_file | 6884b35fd6377d4c4d32336a0bc152f36b64d1e45b6503683cdc238250a8472d | 249974 |

(`tokenizer.bin` is byte-identical across all three variants.)
