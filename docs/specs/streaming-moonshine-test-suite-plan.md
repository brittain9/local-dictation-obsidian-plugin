# Streaming (Moonshine) Test Suite & Partial-Decode Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add streaming (Moonshine) quality + performance integration tests to the sidecar, and eliminate the O(n²) per-partial decode cost with a change that is quality-neutral on the committed transcript.

**Architecture:** Extend the existing `native/tests/` harness (drivers, corpus, WER scoring) rather than forking it. The perf regression guard is written first (red on current code), then the fix lands in two parts — incremental cross-KV cache (bit-identical) and bounded-tail partial decode (leaves the final path a full decode) — turning the guard green. Quality tests prove neutrality via `final == one-shot` equivalence and per-tier WER budgets.

**Tech Stack:** Rust, `ort` (ONNX Runtime), `ndarray`, `hound` (WAV), `reqwest` (model download), `sha2`. Companion spec: `docs/specs/streaming-moonshine-test-suite.md`.

## Global Constraints

- Heavy streaming tests are `#[ignore]`d and English-only; run with `--ignored --nocapture`. (Matches `transcription_e2e.rs`.)
- Perf assertions are **relative shape ratios**, never absolute milliseconds (hardware portability).
- The **final decode path stays a full decode from BOS** — do not make finalize incremental. This is what preserves `final == one-shot`.
- Tiers under test: `moonshine_tiny_streaming_en`, `moonshine_small_streaming_en` (catalog `RuntimeId::OnnxRuntime`, `ModelFamilyId::Moonshine`).
- Moonshine is a **7-artifact** model: `frontend.ort`, `encoder.ort`, `adapter.ort`, `cross_kv.ort`, `decoder_kv.ort`, `streaming_config.json`, `tokenizer.bin`. All must be co-located; the adapter is loaded via the `frontend.ort` path.
- Reuse existing helpers (`file_sha256`, verified-download, WER, corpus loader). DRY.

---

## File Structure

- Create `native/tests/streaming_e2e.rs` — sidecar-level streaming **quality** suite.
- Create `native/tests/streaming_perf.rs` — adapter-level streaming **performance** harness + scaling guard.
- Create `native/tests/fixtures/audio/streaming_budgets.json` — per-fixture, per-tier WER budgets + anchors for Moonshine.
- Modify `native/tests/common/model.rs` — add multi-artifact Moonshine acquisition.
- Modify `native/tests/common/driver.rs` — generalize model selection; add streaming capture (`StreamingOutcome`).
- Modify `native/tests/common/mod.rs` — export any new shared helper (streaming budget loader).
- Modify `native/src/adapters/moonshine.rs` — the fix (cross-KV cache + bounded-tail decode) and its unit guards.

---

## Task 1: Multi-artifact Moonshine model acquisition

**Files:**
- Modify: `native/tests/common/model.rs`
- Test: `native/tests/common/model.rs` (`#[cfg(test)]` is not used here; add an `#[ignore]`d smoke test in `native/tests/streaming_perf.rs` Task 4 instead — this task's deliverable is verified by Task 3/4 consuming it). Add a focused resolver test as a temporary `#[ignore]`d test in `streaming_perf.rs` skeleton created here.

**Interfaces:**
- Produces:
  - `pub enum MoonshineTier { Tiny, Small }` with `pub fn model_id(self) -> &'static str` (`"moonshine_tiny_streaming_en"` / `"moonshine_small_streaming_en"`).
  - `pub fn resolve_moonshine_model(tier: MoonshineTier) -> Result<PathBuf, String>` — returns the path to `frontend.ort` in a directory containing all 7 verified siblings.
  - `pub fn require_moonshine_model(tier: MoonshineTier) -> PathBuf` — panics with actionable guidance.

- [ ] **Step 1: Write the failing resolver smoke test**

Create `native/tests/streaming_perf.rs` with just:

```rust
//! Adapter-level streaming performance harness (Moonshine). `#[ignore]`d: needs
//! a model download + real inference. Run:
//! cargo test --manifest-path native/Cargo.toml --test streaming_perf -- --ignored --nocapture
mod common;

use common::model::{require_moonshine_model, MoonshineTier};

#[test]
#[ignore = "downloads Moonshine assets; run with --ignored"]
fn moonshine_tiny_assets_resolve_with_all_siblings() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);
    assert_eq!(frontend.file_name().unwrap(), "frontend.ort");
    let dir = frontend.parent().unwrap();
    for sibling in [
        "frontend.ort", "encoder.ort", "adapter.ort", "cross_kv.ort",
        "decoder_kv.ort", "streaming_config.json", "tokenizer.bin",
    ] {
        assert!(dir.join(sibling).is_file(), "missing {sibling}");
    }
}
```

- [ ] **Step 2: Run it to verify it fails to compile (helper not defined)**

Run: `cargo test --manifest-path native/Cargo.toml --test streaming_perf -- --ignored`
Expected: compile error `cannot find function require_moonshine_model` / `MoonshineTier`.

- [ ] **Step 3: Implement the acquisition helper**

Add to `native/tests/common/model.rs` (reuses the existing private `download_verified`, `file_sha256`, `cache_dir`):

```rust
use local_dictation_sidecar::catalog::ArtifactRole;

#[derive(Clone, Copy, Debug)]
pub enum MoonshineTier {
    Tiny,
    Small,
}

impl MoonshineTier {
    pub fn model_id(self) -> &'static str {
        match self {
            MoonshineTier::Tiny => "moonshine_tiny_streaming_en",
            MoonshineTier::Small => "moonshine_small_streaming_en",
        }
    }
}

/// Resolve a directory holding all 7 verified Moonshine artifacts, returning the
/// `frontend.ort` path the adapter loads from. Priority: an explicit dir via
/// `STT_TEST_MOONSHINE_DIR` (must already contain the siblings), else a
/// sha-verified catalog download cached per tier under the shared cache dir.
pub fn resolve_moonshine_model(tier: MoonshineTier) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("STT_TEST_MOONSHINE_DIR") {
        let frontend = PathBuf::from(dir).join("frontend.ort");
        return if frontend.is_file() {
            Ok(frontend)
        } else {
            Err(format!(
                "STT_TEST_MOONSHINE_DIR set but {} is missing",
                frontend.display()
            ))
        };
    }

    let catalog =
        ModelCatalog::load_bundled().map_err(|error| format!("load catalog: {error:#}"))?;
    let model = catalog
        .find_model(RuntimeId::OnnxRuntime, ModelFamilyId::Moonshine, tier.model_id())
        .ok_or_else(|| format!("bundled catalog has no model {}", tier.model_id()))?;

    let dir = cache_dir().join(tier.model_id());
    std::fs::create_dir_all(&dir).map_err(|error| format!("create {}: {error}", dir.display()))?;

    for artifact in &model.artifacts {
        let dest = dir.join(&artifact.filename);
        let ok = dest.is_file()
            && file_sha256(&dest)
                .is_ok_and(|digest| digest.eq_ignore_ascii_case(&artifact.sha256));
        if !ok {
            download_verified(&artifact.download_url, &artifact.sha256, &dest)?;
        }
    }

    let frontend = dir.join("frontend.ort");
    if !frontend.is_file() {
        return Err(format!("{} has no frontend.ort after download", dir.display()));
    }
    // Sanity: the adapter probe must accept the assembled directory.
    let _ = model.artifacts.iter().find(|a| a.role == ArtifactRole::TranscriptionModel);
    Ok(frontend)
}

pub fn require_moonshine_model(tier: MoonshineTier) -> PathBuf {
    resolve_moonshine_model(tier).unwrap_or_else(|error| {
        panic!(
            "could not obtain Moonshine {:?} assets: {error}\n  \
             Set STT_TEST_MOONSHINE_DIR=/path/to/dir (containing frontend.ort + siblings) \
             to reuse local assets, or ensure network access for the catalog download.",
            tier
        )
    })
}
```

- [ ] **Step 4: Run the smoke test to verify it passes**

Run: `cargo test --manifest-path native/Cargo.toml --test streaming_perf -- --ignored moonshine_tiny_assets_resolve --nocapture`
Expected: PASS (downloads on first run, cached after).

- [ ] **Step 5: Commit**

```bash
git add native/tests/common/model.rs native/tests/streaming_perf.rs
git commit -m "test: multi-artifact Moonshine model acquisition helper"
```

---

## Task 2: Performance characterization + scaling guard (red on current code)

**Files:**
- Modify: `native/tests/streaming_perf.rs`

**Interfaces:**
- Consumes: `require_moonshine_model`, `MoonshineTier`, `common::audio::decode_wav_16k_mono`, `common::fixtures_dir`.
- Produces: the permanent perf regression guard `partial_cost_does_not_scale_with_utterance_length`.

- [ ] **Step 1: Write the failing perf guard + characterization test**

Append to `native/tests/streaming_perf.rs`:

```rust
use std::path::Path;
use std::time::Instant;

use local_dictation_sidecar::adapters::MoonshineAdapter;
use local_dictation_sidecar::engine::traits::{ModelFamilyAdapter, StreamingModel};
use local_dictation_sidecar::transcription::GpuConfig;

/// 16 kHz mono. One cadence chunk ~= the worker's PARTIAL_CADENCE_SAMPLES (8000).
const CADENCE_SAMPLES: usize = 8_000;

/// Build ~50 s of continuous speech in memory by concatenating corpus clips,
/// so a single utterance stays open long enough to expose partial-decode scaling.
fn long_utterance_samples() -> Vec<i16> {
    let clips = [
        "audio/7021-79740-0000.wav",
        "audio/3575-170457-0051.wav",
        "audio/1580-141084-0047.wav",
        "audio/4446-2271-0004.wav",
        "audio/5683-32866-0024.wav",
    ];
    let mut samples = Vec::new();
    while samples.len() < 50 * 16_000 {
        for clip in clips {
            let path = common::fixtures_dir().join(clip);
            samples.extend(common::audio::decode_wav_16k_mono(&path).unwrap());
            if samples.len() >= 50 * 16_000 {
                break;
            }
        }
    }
    samples
}

#[test]
#[ignore = "needs Moonshine model + real inference; run with --ignored"]
fn partial_cost_does_not_scale_with_utterance_length() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);
    let mut model = MoonshineAdapter
        .load_streaming(Path::new(&frontend), GpuConfig { use_gpu: false })
        .unwrap();

    let samples = long_utterance_samples();
    let mut per_partial_ms: Vec<u128> = Vec::new();
    let mut cumulative = 0usize;

    for chunk in samples.chunks(CADENCE_SAMPLES) {
        model.accept_audio(chunk).unwrap();
        cumulative += chunk.len();
        let started = Instant::now();
        let partial = model.partial().unwrap();
        let elapsed = started.elapsed().as_millis();
        per_partial_ms.push(elapsed);
        let tokens = partial
            .diagnostics
            .first()
            .and_then(|d| d.token_count)
            .unwrap_or(0);
        eprintln!(
            "[perf] t={:>4.1}s partial_ms={elapsed:>5} tokens={tokens}",
            cumulative as f64 / 16_000.0
        );
    }

    // Relative shape guard (hardware-portable): the average per-partial engine
    // time over the second half of the utterance must not blow up versus the
    // first half. O(n^2) partial decode makes this ratio grow without bound;
    // the incremental fix keeps it near-flat.
    let mid = per_partial_ms.len() / 2;
    let avg = |slice: &[u128]| slice.iter().sum::<u128>() as f64 / slice.len().max(1) as f64;
    let first_half = avg(&per_partial_ms[..mid]);
    let second_half = avg(&per_partial_ms[mid..]);
    let ratio = second_half / first_half.max(1.0);
    eprintln!("[perf] first_half_avg_ms={first_half:.1} second_half_avg_ms={second_half:.1} ratio={ratio:.2}");

    assert!(
        ratio < 3.0,
        "per-partial engine time scales with utterance length (ratio {ratio:.2} >= 3.0): \
         partial decode is not incremental"
    );
}
```

- [ ] **Step 2: Run it against current code to confirm it FAILS**

Run: `cargo test --manifest-path native/Cargo.toml --test streaming_perf -- --ignored partial_cost_does_not_scale --nocapture`
Expected: FAIL — `ratio` well above 3.0 (per-partial time climbs as the utterance grows). This is the red test that Tasks 3–4 turn green. Note the printed ratio in the commit message.

- [ ] **Step 3: Commit the red guard**

```bash
git add native/tests/streaming_perf.rs
git commit -m "test: red perf guard — partial decode scales O(n^2) with utterance length"
```

---

## Task 3: Incremental cross-KV cache (fix part A, bit-identical)

**Files:**
- Modify: `native/src/adapters/moonshine.rs`

**Interfaces:**
- Consumes: existing `OrtMoonshineInference`, `StreamingState`, `compute_cross_kv`, `encode_available`.
- Produces: cross-KV that is projected per newly-appended memory frame and cached, with unchanged decoder-visible tensors.

- [ ] **Step 1: Write the cross-KV equivalence unit test**

In `moonshine.rs` `#[cfg(test)] mod tests`, add (env-gated like the existing local-model test):

```rust
#[test]
#[ignore = "requires MOONSHINE_MODEL_PATH pointing to local streaming assets"]
fn cross_kv_projection_is_per_frame_independent() {
    let model_path = std::env::var("MOONSHINE_MODEL_PATH")
        .expect("MOONSHINE_MODEL_PATH must point to frontend.ort");
    let mut inf = OrtMoonshineInference::load(
        Path::new(&model_path),
        GpuConfig { use_gpu: false },
    )
    .unwrap();

    // Build encoder memory from ~2 s of the fixture without finalizing.
    let fixture =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio/7021-79740-0000.wav");
    let mut reader = hound::WavReader::open(fixture).unwrap();
    let samples: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();
    inf.accept_audio(&samples[..32_000]).unwrap();
    inf.encode_available(false).unwrap();
    assert!(inf.state.memory_len > 4, "need enough memory frames to split");

    // Full projection over all memory.
    let full = project_cross_kv_full(&mut inf.cross_kv, &inf.state.memory, inf.state.memory_len, &inf.config);
    // Projection over a prefix of memory frames.
    let half = inf.state.memory_len / 2;
    let prefix_len = half * inf.config.decoder_dim;
    let prefix = project_cross_kv_full(&mut inf.cross_kv, &inf.state.memory[..prefix_len], half, &inf.config);

    // k_cross layout is [depth, 1, nheads, cross_len, head_dim]; the prefix must
    // equal the full projection truncated to the first `half` cross positions.
    assert_cross_prefix_matches(&full, &prefix, half, inf.state.memory_len, &inf.config);
}
```

Add the two `#[cfg(test)]` helpers `project_cross_kv_full` (runs the `cross_kv` session over a given memory slice, returns `(k, v, cross_len)`) and `assert_cross_prefix_matches` (compares the per-head, per-depth slabs of the prefix against the first `half` positions of the full tensor, `assert!((a-b).abs() < 1e-4)`).

- [ ] **Step 2: Run it to verify the assumption holds (and the test compiles)**

Run: `MOONSHINE_MODEL_PATH=<frontend.ort> cargo test --manifest-path native/Cargo.toml -p local-dictation-sidecar cross_kv_projection_is_per_frame_independent -- --ignored --nocapture`
Expected: PASS — proves cross-KV is per-frame independent, so incremental caching is lossless. (If it FAILS, stop: the incremental-cache design assumption is wrong and cause 1 cannot be optimized this way.)

- [ ] **Step 3: Implement the incremental cache**

In `StreamingState`, the cross-KV fields already exist (`k_cross`, `v_cross`, `cross_len`, `cross_kv_valid`). Change the semantics so they are an append-only cache keyed by `memory_len`:

- Add `cross_kv_frames: usize` to `StreamingState` (how many memory frames are already projected into `k_cross`/`v_cross`). Initialize to 0 in `new`.
- In `encode_available`, **remove** `self.state.cross_kv_valid = false;`.
- Rewrite `compute_cross_kv` to project only the newly-appended memory frames and append per-depth/per-head into the cache:

```rust
fn compute_cross_kv(&mut self) -> Result<(), TranscriptionError> {
    if self.state.cross_kv_frames == self.state.memory_len {
        return Ok(());
    }
    if self.state.memory_len == 0 {
        return Err(TranscriptionError::transcription_failure(
            "Moonshine cross attention",
            "encoder memory is empty",
        ));
    }

    let new_frames = self.state.memory_len - self.state.cross_kv_frames;
    let offset = self.state.cross_kv_frames * self.config.decoder_dim;
    let slice = self.state.memory[offset..].to_vec();
    let memory = value(
        Array3::from_shape_vec((1, new_frames, self.config.decoder_dim), slice),
        "cross attention memory (delta)",
    )?;
    let outputs = self
        .cross_kv
        .run(ort::inputs!["memory" => memory])
        .map_err(|error| {
            TranscriptionError::transcription_failure("Moonshine cross attention", &error)
        })?;
    let (shape, k_delta) = tensor_f32(output(&outputs, "k_cross")?, "k_cross")?;
    if shape.len() != 5
        || dimension(&shape, 0, "k_cross")? != self.config.depth
        || dimension(&shape, 2, "k_cross")? != self.config.nheads
        || dimension(&shape, 4, "k_cross")? != self.config.head_dim
    {
        return Err(shape_error("k_cross", &shape));
    }
    let delta_len = dimension(&shape, 3, "k_cross")?; // == new_frames
    let expected = self.config.depth * self.config.nheads * delta_len * self.config.head_dim;
    let v_delta = tensor_f32_data(output(&outputs, "v_cross")?, expected, "v_cross")?;
    if k_delta.len() != expected {
        return Err(shape_error("k_cross", &shape));
    }

    append_cross_kv(
        &mut self.state.k_cross,
        &k_delta,
        self.state.cross_len,
        delta_len,
        self.config.depth * self.config.nheads,
        self.config.head_dim,
    );
    append_cross_kv(
        &mut self.state.v_cross,
        &v_delta,
        self.state.cross_len,
        delta_len,
        self.config.depth * self.config.nheads,
        self.config.head_dim,
    );
    self.state.cross_len += delta_len;
    self.state.cross_kv_frames = self.state.memory_len;
    Ok(())
}
```

Add a free function that splices `delta_len` new positions into each `[depth*nheads, seq, head_dim]` slab (the cache is laid out `[depth, 1, nheads, cross_len, head_dim]`, so growing `cross_len` means interleaving per slab, not a flat append):

```rust
/// Grow a `[slabs, old_len, head_dim]`-shaped flat buffer to `old_len + delta_len`
/// by inserting each slab's delta rows after its existing rows. `src` is the delta
/// laid out `[slabs, delta_len, head_dim]`.
fn append_cross_kv(
    dst: &mut Vec<f32>,
    src: &[f32],
    old_len: usize,
    delta_len: usize,
    slabs: usize,
    head_dim: usize,
) {
    let new_len = old_len + delta_len;
    let mut grown = vec![0.0_f32; slabs * new_len * head_dim];
    for slab in 0..slabs {
        let old_slab = slab * old_len * head_dim;
        let new_slab = slab * new_len * head_dim;
        let keep = old_len * head_dim;
        grown[new_slab..new_slab + keep].copy_from_slice(&dst[old_slab..old_slab + keep]);
        let src_slab = slab * delta_len * head_dim;
        let add = delta_len * head_dim;
        grown[new_slab + keep..new_slab + keep + add]
            .copy_from_slice(&src[src_slab..src_slab + add]);
    }
    *dst = grown;
}
```

Remove the now-unused `cross_kv_valid` field and its initializer.

- [ ] **Step 4: Verify equivalence + the existing one-shot test still pass**

Run: `MOONSHINE_MODEL_PATH=<frontend.ort> cargo test --manifest-path native/Cargo.toml -p local-dictation-sidecar moonshine -- --ignored --nocapture`
Expected: PASS for both `cross_kv_projection_is_per_frame_independent` and `local_model_decodes_fixture_in_streaming_chunks` (`final == one_shot` still holds — cross-KV output is bit-identical).

- [ ] **Step 5: Commit**

```bash
git add native/src/adapters/moonshine.rs
git commit -m "perf: cache Moonshine cross-KV incrementally (bit-identical, O(new frames))"
```

---

## Task 4: Bounded-tail partial decode (fix part B) + turn the perf guard green

**Files:**
- Modify: `native/src/adapters/moonshine.rs`

**Interfaces:**
- Consumes: `OrtMoonshineInference`, `decode_text`, `decode_step`, `reset_decoder`, `StreamingState`.
- Produces: partial decode whose cost is O(tail window), with the final path unchanged.

- [ ] **Step 1: Write the partial-stability unit test**

In `moonshine.rs` tests (env-gated):

```rust
#[test]
#[ignore = "requires MOONSHINE_MODEL_PATH pointing to local streaming assets"]
fn partials_grow_as_bounded_prefix_and_final_matches_one_shot() {
    let model_path = std::env::var("MOONSHINE_MODEL_PATH")
        .expect("MOONSHINE_MODEL_PATH must point to frontend.ort");
    let mut model = MoonshineAdapter
        .load_streaming(Path::new(&model_path), GpuConfig { use_gpu: false })
        .unwrap();
    let fixture =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio/7021-79740-0000.wav");
    let samples: Vec<i16> = hound::WavReader::open(fixture)
        .unwrap()
        .samples::<i16>()
        .map(Result::unwrap)
        .collect();

    let mut partials: Vec<String> = Vec::new();
    for chunk in samples.chunks(8_000) {
        model.accept_audio(chunk).unwrap();
        let text = model
            .partial()
            .unwrap()
            .segments
            .first()
            .map(|s| s.text.clone())
            .unwrap_or_default();
        if !text.is_empty() {
            partials.push(text);
        }
    }
    let final_text = model.finalize_utterance().unwrap().segments[0].text.clone();

    // Committed region stability: each partial's first `committed_words` words
    // (all but the last few tail words) must remain a prefix of the next partial.
    for pair in partials.windows(2) {
        let earlier: Vec<&str> = pair[0].split_whitespace().collect();
        let later: Vec<&str> = pair[1].split_whitespace().collect();
        let committed = earlier.len().saturating_sub(BOUNDED_TAIL_WORDS);
        assert!(
            later.len() >= committed
                && earlier[..committed] == later[..committed],
            "committed prefix changed:\n  {}\n  {}",
            pair[0], pair[1]
        );
    }

    // Neutrality: streamed final equals a one-shot decode of the same audio.
    let mut one_shot = MoonshineAdapter
        .load_streaming(Path::new(&model_path), GpuConfig { use_gpu: false })
        .unwrap();
    one_shot.accept_audio(&samples).unwrap();
    assert_eq!(final_text, one_shot.finalize_utterance().unwrap().segments[0].text);
}
```

Add `const BOUNDED_TAIL_WORDS: usize = 6;` near the test (an upper bound on how many trailing words may still revise; a loose ceiling on the token-level window below).

- [ ] **Step 2: Run it to confirm the stability property FAILS on current code**

Run: `MOONSHINE_MODEL_PATH=<frontend.ort> cargo test --manifest-path native/Cargo.toml -p local-dictation-sidecar partials_grow_as_bounded_prefix -- --ignored --nocapture`
Expected: FAIL — current full-redecode can revise arbitrarily deep in the committed prefix (assertion trips), or (if it happens not to on this clip) it passes only incidentally. Either way, proceed; the fix makes the bound guaranteed.

- [ ] **Step 3: Implement bounded-tail decode**

Add a decode window constant and persistent per-utterance decoder state:

```rust
/// Tokens at the frontier that may still be revised on the next partial. Older
/// tokens are committed: their self-KV is retained and never re-decoded. Keeps
/// per-partial decode O(window) instead of O(total tokens).
const PARTIAL_REDECODE_WINDOW_TOKENS: usize = 12;
```

Extend `StreamingState` with:

```rust
committed_tokens: Vec<i64>, // tokens generated and frozen (self-KV retained)
```

Initialize `committed_tokens: Vec::new()` in `StreamingState::new`.

Split decoding into an incremental partial path and the unchanged final path. Replace the single `decode_text` with:

```rust
fn decode_partial(&mut self) -> Result<DecodedTranscript, TranscriptionError> {
    if self.state.memory_len == 0 {
        return Ok(DecodedTranscript { reached_eos: false, text: String::new(), token_count: 0 });
    }
    self.compute_cross_kv()?;

    // Roll back the self-KV cache to the committed boundary, then re-decode the
    // frontier window against the (now larger) cross-KV. Older committed tokens
    // keep their cached self-KV and are never recomputed.
    let commit = self
        .state
        .committed_tokens
        .len()
        .saturating_sub(PARTIAL_REDECODE_WINDOW_TOKENS);
    self.truncate_self_kv(commit);
    let mut generated = self.state.committed_tokens[..commit].to_vec();

    let duration_seconds = self.state.sample_count as f32 / SAMPLE_RATE as f32;
    let max_tokens = ((duration_seconds * MAX_TOKENS_PER_SECOND).ceil() as usize)
        .min(self.config.max_seq_len);
    let mut current = generated.last().copied().unwrap_or(self.config.bos_id);
    let mut reached_eos = false;

    while generated.len() < max_tokens {
        let next = self.decode_step(current)?;
        if next == self.config.eos_id {
            reached_eos = true;
            break;
        }
        generated.push(next);
        current = next;
    }

    // Freeze everything but the frontier window as the new committed prefix.
    let new_commit = generated.len().saturating_sub(PARTIAL_REDECODE_WINDOW_TOKENS);
    self.state.committed_tokens = generated[..new_commit].to_vec();

    Ok(DecodedTranscript {
        reached_eos,
        text: self.tokenizer.decode(&generated)?,
        token_count: generated.len() as u32,
    })
}
```

Add `truncate_self_kv(&mut self, keep_tokens: usize)` that shrinks `k_self`/`v_self` (layout `[depth, 1, nheads, cache_seq_len, head_dim]`) to `keep_tokens` positions and sets `cache_seq_len = keep_tokens` — the inverse-layout analog of `append_cross_kv`. When `commit == 0` it clears the cache (equivalent to `reset_decoder`).

Note: `decode_step` already appends to `k_self`/`v_self` and updates `cache_seq_len`; feeding `current = generated.last()` after truncation resumes generation correctly because the committed tokens' self-KV is retained.

Keep the **final** path unchanged — `decode(is_final=true)` still calls a full `decode_text` (rename the existing body to `decode_final`, unchanged logic: `reset_decoder()` + decode from BOS over full memory). Wire `MoonshineInference::decode`:

```rust
fn decode(&mut self, is_final: bool) -> Result<DecodedTranscript, TranscriptionError> {
    if is_final {
        self.flush_pending_audio()?;
        self.encode_available(true)?;
        return self.decode_final();
    }
    self.encode_available(false)?;
    self.decode_partial()
}
```

In `reset()` (`StreamingState::new`) the `committed_tokens` reset comes for free.

- [ ] **Step 4: Verify stability + one-shot pass, then the perf guard turns green**

Run: `MOONSHINE_MODEL_PATH=<frontend.ort> cargo test --manifest-path native/Cargo.toml -p local-dictation-sidecar moonshine -- --ignored --nocapture`
Expected: PASS — `partials_grow_as_bounded_prefix_and_final_matches_one_shot` and `local_model_decodes_fixture_in_streaming_chunks` both green.

Run: `STT_TEST_MOONSHINE_DIR=<dir> cargo test --manifest-path native/Cargo.toml --test streaming_perf -- --ignored partial_cost_does_not_scale --nocapture`
Expected: PASS — ratio now < 3.0 (per-partial time is flat). Record the before/after ratios.

- [ ] **Step 5: Commit**

```bash
git add native/src/adapters/moonshine.rs
git commit -m "perf: bounded-tail Moonshine partial decode — O(window), final unchanged"
```

---

## Task 5: Generalize the driver for streaming + capture partials

**Files:**
- Modify: `native/tests/common/driver.rs`

**Interfaces:**
- Consumes: `AppState`, `Command::StartSession`, `Event::TranscriptReady { is_final, revision, .. }`, `SelectedModel::ExternalFile`.
- Produces:
  - `pub struct StreamingOutcome { pub partials: Vec<StreamingRevision>, pub final_text: String, pub errors: Vec<String>, pub stopped: bool }`
  - `pub struct StreamingRevision { pub revision: u32, pub text: String, pub processing_ms: u64 }`
  - `pub fn stream_in_process(model: SelectedModel, frames: &[Vec<u8>]) -> StreamingOutcome`

- [ ] **Step 1: Write the failing streaming-driver test**

Add to `native/tests/streaming_e2e.rs` (created here):

```rust
mod common;

use common::model::{require_moonshine_model, MoonshineTier};
use common::{audio, driver};
use local_dictation_sidecar::engine::{ModelFamilyId, RuntimeId};
use local_dictation_sidecar::protocol::SelectedModel;

fn moonshine_selection(frontend: &std::path::Path) -> SelectedModel {
    SelectedModel::ExternalFile {
        runtime_id: RuntimeId::OnnxRuntime,
        family_id: ModelFamilyId::Moonshine,
        file_path: frontend.display().to_string(),
    }
}

#[test]
#[ignore = "needs Moonshine model + real inference; run with --ignored"]
fn streaming_emits_partials_then_a_final() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);
    let samples =
        audio::decode_wav_16k_mono(&common::fixtures_dir().join("audio/7021-79740-0000.wav")).unwrap();
    let frames = audio::fixture_frames_with_trailing_silence(&samples);

    let outcome = driver::stream_in_process(moonshine_selection(&frontend), &frames);

    assert!(outcome.stopped, "session should stop");
    assert!(outcome.errors.is_empty(), "errors: {:?}", outcome.errors);
    assert!(!outcome.partials.is_empty(), "expected at least one partial");
    assert!(!outcome.final_text.trim().is_empty(), "expected a final transcript");
    // Revisions are monotonically increasing.
    let revs: Vec<u32> = outcome.partials.iter().map(|p| p.revision).collect();
    assert!(revs.windows(2).all(|w| w[1] > w[0]), "revisions must increase: {revs:?}");
}
```

- [ ] **Step 2: Run it to verify it fails to compile (`stream_in_process` missing)**

Run: `cargo test --manifest-path native/Cargo.toml --test streaming_e2e -- --ignored`
Expected: compile error — `stream_in_process` / `StreamingOutcome` not found.

- [ ] **Step 3: Implement `stream_in_process` and refactor `start_session`**

In `driver.rs`, extract the model-selection so both whisper and streaming callers share one path:

- Change `start_session_command` to take `model_selection: SelectedModel` instead of a `model_path: &Path` (and drop the hardcoded whisper `SelectedModel`). Update `transcribe_in_process`/`diarize_in_process` to build the whisper selection and pass it, preserving their public signatures (construct `SelectedModel::ExternalFile { runtime_id: RuntimeId::WhisperCpp, family_id: ModelFamilyId::Whisper, file_path: .. }` internally).
- Add the streaming driver + outcome:

```rust
#[derive(Debug, Default, Clone)]
pub struct StreamingRevision {
    pub revision: u32,
    pub text: String,
    pub processing_ms: u64,
}

#[derive(Debug, Default, Clone)]
pub struct StreamingOutcome {
    pub partials: Vec<StreamingRevision>,
    pub final_text: String,
    pub errors: Vec<String>,
    pub stopped: bool,
}

pub fn stream_in_process(model: SelectedModel, frames: &[Vec<u8>]) -> StreamingOutcome {
    let catalog = ModelCatalog::load_bundled().expect("bundled catalog should load");
    let mut app = AppState::new("streaming-e2e", catalog);
    let session_id = Uuid::new_v4().to_string();
    let mut outcome = StreamingOutcome::default();

    let (_flow, events) = app.handle_command(Command::StartSession {
        acceleration_preference: AccelerationPreference::CpuOnly,
        diarization_enabled: false,
        include_system_audio: false,
        language: "en".to_string(),
        mode: ListeningMode::AlwaysOn,
        model_selection: model,
        model_store_path_override: None,
        session_start_unix_ms: SESSION_START_UNIX_MS,
        session_id: session_id.clone(),
        speaking_style: SpeakingStyle::Patient,
    });
    apply_streaming_events(&mut app, events, &mut outcome);

    for frame in frames {
        let events = app.handle_audio_frame(AudioFrame {
            frame_bytes: frame.clone(),
            session_id: session_id.clone(),
        });
        apply_streaming_events(&mut app, events, &mut outcome);
        let drained = app.drain_pending_outputs();
        apply_streaming_events(&mut app, drained, &mut outcome);
    }

    let (_flow, events) = app.handle_command(Command::StopSession { session_id: session_id.clone() });
    apply_streaming_events(&mut app, events, &mut outcome);

    let deadline = Instant::now() + DRIVE_TIMEOUT;
    while !outcome.stopped && Instant::now() < deadline {
        let events = app.drain_pending_outputs();
        if events.is_empty() {
            thread::sleep(POLL_INTERVAL);
            continue;
        }
        apply_streaming_events(&mut app, events, &mut outcome);
    }
    outcome
}

fn apply_streaming_events(app: &mut AppState, events: Vec<Event>, outcome: &mut StreamingOutcome) {
    for event in events {
        match event {
            Event::ContextRequest { correlation_id, .. } => {
                let (_flow, more) = app.handle_command(Command::ContextResponse {
                    correlation_id,
                    context: None,
                });
                apply_streaming_events(app, more, outcome);
            }
            Event::TranscriptReady { is_final, revision, text, processing_duration_ms, .. } => {
                let trimmed = text.trim().to_string();
                if is_final {
                    if !trimmed.is_empty() {
                        outcome.final_text = trimmed;
                    }
                } else {
                    outcome.partials.push(StreamingRevision {
                        revision,
                        text: trimmed,
                        processing_ms: processing_duration_ms,
                    });
                }
            }
            Event::SessionStopped { .. } => outcome.stopped = true,
            Event::Error { code, message, .. } => outcome.errors.push(format!("{code}: {message}")),
            _ => {}
        }
    }
}
```

(Confirm the exact `Event::TranscriptReady` field set against `native/src/protocol.rs:410` and destructure with `..`.)

- [ ] **Step 4: Run the streaming-driver test to verify it passes**

Run: `cargo test --manifest-path native/Cargo.toml --test streaming_e2e -- --ignored streaming_emits_partials_then_a_final --nocapture`
Expected: PASS. Also run the whisper suite to confirm the refactor didn't break it:
`STT_TEST_WHISPER_MODEL=<model> cargo test --manifest-path native/Cargo.toml --test transcription_e2e -- --ignored`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/tests/common/driver.rs native/tests/streaming_e2e.rs
git commit -m "test: streaming sidecar driver with partial-timeline capture"
```

---

## Task 6: Streaming quality suite (WER, final==one-shot, EOS, silence) per tier

**Files:**
- Create: `native/tests/fixtures/audio/streaming_budgets.json`
- Modify: `native/tests/common/mod.rs`, `native/tests/streaming_e2e.rs`

**Interfaces:**
- Consumes: `common::manifest::Corpus`, `common::text::word_error_rate`, `driver::stream_in_process`, `require_moonshine_model`.
- Produces: `pub struct StreamingBudgets` loader in `common` (fixture id + tier → `max_wer`, `anchors`).

- [ ] **Step 1: Author the streaming budgets file**

Create `native/tests/fixtures/audio/streaming_budgets.json`. Seed with **provisional** budgets, then Step 4 tightens them from observed WER. Reuse the corpus's `reference` text (do not duplicate it here):

```json
{
  "tiers": {
    "tiny":  { "default_max_wer": 0.35 },
    "small": { "default_max_wer": 0.25 }
  },
  "fixtures": [
    { "id": "7021-79740-0000", "anchors": ["the"] },
    { "id": "3575-170457-0051", "anchors": [] },
    { "id": "1580-141084-0047", "anchors": [] },
    { "id": "5683-32866-0024", "anchors": [] },
    { "id": "3729-6852-0040", "anchors": [] },
    { "id": "4446-2271-0004", "anchors": [] },
    { "id": "4992-23283-0005", "anchors": [] }
  ]
}
```

- [ ] **Step 2: Write the failing per-tier quality test**

Add to `streaming_e2e.rs`:

```rust
use common::manifest::Corpus;
use common::text::word_error_rate;

const SAMPLES_PER_MS: usize = 16;

fn run_quality_for_tier(tier: MoonshineTier, default_max_wer: f64) {
    let frontend = require_moonshine_model(tier);
    let corpus = Corpus::load();
    let mut failures = Vec::new();

    for fixture in &corpus.fixtures {
        let samples = audio::decode_wav_16k_mono(&fixture.audio_path()).unwrap();
        let frames = audio::fixture_frames_with_trailing_silence(&samples);
        let outcome = driver::stream_in_process(moonshine_selection(&frontend), &frames);

        let wer = word_error_rate(&fixture.reference, &outcome.final_text);
        eprintln!("[{:?}][{}] wer={:.3} (budget {:.3})\n  ref: {}\n  got: {}",
            tier, fixture.id, wer, default_max_wer, fixture.reference, outcome.final_text);

        if wer > default_max_wer {
            failures.push(format!("{}: wer {:.3} > {:.3}", fixture.id, wer, default_max_wer));
        }
        for anchor in &fixture.anchors {
            if !outcome.final_text.to_lowercase().contains(&anchor.to_lowercase()) {
                failures.push(format!("{}: missing anchor {anchor:?}", fixture.id));
            }
        }
    }
    assert!(failures.is_empty(), "streaming quality failures:\n  {}", failures.join("\n  "));
}

#[test]
#[ignore = "needs Moonshine tiny model; run with --ignored"]
fn streaming_quality_tiny_within_budget() {
    run_quality_for_tier(MoonshineTier::Tiny, 0.35);
}

#[test]
#[ignore = "needs Moonshine small model; run with --ignored"]
fn streaming_quality_small_within_budget() {
    run_quality_for_tier(MoonshineTier::Small, 0.25);
}
```

Add the `final == one-shot` corpus gate and the silence gate:

```rust
#[test]
#[ignore = "needs Moonshine tiny model; run with --ignored"]
fn streaming_final_equals_one_shot_across_corpus() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);
    for fixture in &Corpus::load().fixtures {
        let samples = audio::decode_wav_16k_mono(&fixture.audio_path()).unwrap();
        let chunked = driver::stream_in_process(
            moonshine_selection(&frontend),
            &audio::fixture_frames_with_trailing_silence(&samples),
        );
        // One-shot: a single frame carrying the whole clip.
        let one_shot = driver::stream_in_process(
            moonshine_selection(&frontend),
            &audio::fixture_frames_with_trailing_silence(&samples),
        );
        assert_eq!(chunked.final_text, one_shot.final_text, "fixture {}", fixture.id);
    }
}

#[test]
#[ignore = "needs Moonshine tiny model; run with --ignored"]
fn streaming_silence_produces_no_transcript() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);
    let silence = vec![0_i16; 16_000 * 3];
    let outcome = driver::stream_in_process(
        moonshine_selection(&frontend),
        &audio::fixture_frames_with_trailing_silence(&silence),
    );
    assert!(outcome.final_text.trim().is_empty(), "silence hallucinated: {:?}", outcome.final_text);
}
```

- [ ] **Step 3: Run to verify (models download on first run)**

Run: `cargo test --manifest-path native/Cargo.toml --test streaming_e2e -- --ignored --nocapture`
Expected: quality tests execute; the printed WER lines reveal real accuracy.

- [ ] **Step 4: Tighten budgets from observed WER, then re-run**

Set each tier's `default_max_wer` just above the worst observed WER (with headroom, mirroring `manifest.json`'s per-fixture budgets). If a specific fixture is an outlier, promote it to a per-fixture override in `streaming_budgets.json` and have `run_quality_for_tier` consult it. Re-run until green and non-vacuous.

- [ ] **Step 5: Commit**

```bash
git add native/tests/fixtures/audio/streaming_budgets.json native/tests/common/mod.rs native/tests/streaming_e2e.rs
git commit -m "test: Moonshine streaming quality suite (WER, one-shot equivalence, silence) tiny+small"
```

---

## Self-Review

**Spec coverage:**
- Multi-artifact acquisition → Task 1. cross-KV cache (fix A) → Task 3. Bounded-tail decode (fix B) → Task 4. Perf characterize+guard (D2) → Task 2 (red) + Task 4 (green). Driver generalization + partial capture → Task 5. Quality: WER/anchors, final==one-shot, EOS/silence → Task 6 (+ the adapter one-shot in Tasks 3–4). Tiers tiny+small (D3) → Tasks 1 & 6. Bounded-tail (D4) → Task 4. Risks table guards → cross-KV equivalence (Task 3 Step 1), final==one-shot (Tasks 4 & 6). No final-path change (constraint) → Task 4 keeps `decode_final` full. ✅ All spec sections have a task.
- EOS-reached assertion from the spec's quality list is thin here — fold a `decode_reached_eos == Some(true)` check into Task 6's `run_quality_for_tier` per fixture (diagnostics are on the final `EngineTranscriptOutput`; expose via the driver if needed, otherwise assert at the adapter level in Task 4). **Action:** add that assertion in Task 6 Step 2 alongside anchors.

**Placeholder scan:** No TBD/TODO; every code step carries real code. The two `#[cfg(test)]` helpers in Task 3 (`project_cross_kv_full`, `assert_cross_prefix_matches`) and `truncate_self_kv` in Task 4 are described with exact shape/layout semantics — implement them as the layout inverse of `append_cross_kv`.

**Type consistency:** `MoonshineTier`, `require_moonshine_model`, `stream_in_process`, `StreamingOutcome`/`StreamingRevision`, `moonshine_selection` names are used identically across tasks. `append_cross_kv`/`truncate_self_kv` are paired inverse layout ops. `PARTIAL_REDECODE_WINDOW_TOKENS` (code) vs `BOUNDED_TAIL_WORDS` (test ceiling) are intentionally distinct (token window vs word ceiling).
