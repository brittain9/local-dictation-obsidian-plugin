# Segment-Level (Turn) Speaker Diarization — Design

- Status: accepted
- Date: 2026-06-22
- Supersedes the v1 per-utterance attribution in
  `2026-06-07-speaker-diarization-design.md`
- Branch: `feat/speaker-diarization`

## Problem

v1 attributes **one speaker per VAD utterance**. VAD cuts on silence, not on
speaker, so in real conversation many speakers' turns fall inside one utterance
and collapse to a single label. Measured on this codebase:

- Controlled (8 distinct voices, identical content, only the inter-turn gap
  changes): 2.0 s gaps → 8/8 speakers correct; 0.3 s gaps → **2/8** (the 16
  turns merge into 5 VAD utterances).
- Real AMI 4-speaker meeting slice → **3** predicted speakers, 19/25 utterances
  dumped onto one label.

The embedding model is not the bottleneck (8/8 when segmentation is clean). The
**unit of attribution** is. Goal: show *who said what at the speaker-turn
level*, decoupled from the VAD utterance.

## Goals

- A finalized utterance may contain multiple speaker turns; each transcript
  **segment** is attributed to a session-stable speaker.
- The note renders one `**Speaker N:**` label per contiguous same-speaker run,
  on its own line, so a multi-speaker utterance reads as a labelled exchange.
- Stays fully local, private, opt-in, and live (per-utterance insertion).
- Single-speaker dictation is unchanged in output.

## Non-goals (this iteration)

- Multi-label overlapped speech (two names on one word). Overlap frames are
  attributed to the dominant local speaker; flagging/splitting overlap is future
  work.
- Renaming / persistent speaker profiles.
- File-import diarization (pipeline is live-capture only).

## Two tiers

- **Tier 0 — voiced-only embeddings.** Embeddings are computed over
  speaker-active audio (the segmentation turns below are speaker-active spans),
  never the whole utterance including silence/music. Replaces the v1 behaviour
  of embedding `request.audio_samples` wholesale and treating total length as
  voiced.
- **Tier 1 — turn splitting via a segmentation model.** A bundled pyannote
  `segmentation-3.0` ONNX yields per-frame speaker activity; we derive
  speaker-homogeneous turns within the utterance, embed each, cluster with the
  existing online registry, and align whisper segments to turns.

## Architecture

```
finalized utterance (16 kHz mono f32) + whisper segments[{start_ms,end_ms,text}]
  └─ IF diarization enabled AND text survived text stages:
       segmentation ONNX  → per-frame powerset → per-frame local-speaker activity
         → turns: [{start_ms, end_ms, local_speaker}]            (turn splitting)
       per turn: voiced PCM slice → embedding ONNX → online registry
         → global speaker_index                                   (Tier 0 + clustering)
       align: each whisper segment ← turn of max temporal overlap
         → segment.speaker = global speaker_index
  → TranscriptReady{ segments:[{…, speaker}], speakerIndex: dominant }
```

Global identity comes from the **existing online registry** (cosine, hysteresis,
short-turn guard), not pyannote's offline clustering — so turns from different
windows / utterances reconcile by voice automatically and stay session-stable.
This is the key simplification versus the full pyannote pipeline: segmentation
finds *boundaries*; embeddings find *identity*.

### Segmentation model

- pyannote `segmentation-3.0`, exported to ONNX by k2-fsa/sherpa-onnx, MIT
  (CNRS). fp32, 5.99 MB. Bundled via `include_bytes!` + provenance manifest +
  sha256/size test, exactly like Silero VAD and the embedding model. Verified to
  load and run a `[1,1,160000]→[1,589,7]` pass under the pinned
  `ort = =2.0.0-rc.12`.
- I/O: input `x: f32[N,1,T]` raw waveform; output `y: f32[N,num_frames,7]`
  powerset logits. Metadata: `window_size=160000` (10 s), `receptive_field_shift=270`
  (16.875 ms/frame), `receptive_field_size=991`, `num_speakers=3`,
  `powerset_max_classes=2`, `num_classes=7`.
- Windowing: process the utterance in **fixed 160000-sample windows**, last/only
  one zero-padded (the model needs a fixed-ish receptive field; padding silence
  decodes to "no speaker"). Non-overlapping windows; a turn spanning a boundary
  becomes two adjacent turns the registry maps to the same id, which the renderer
  merges. (Overlapping windows + stitching is a future refinement.)

### Powerset decode → turns (pure, unit-tested)

- Powerset class → local-speaker set (3 speakers, ≤2 concurrent):
  `0:∅, 1:{0}, 2:{1}, 3:{2}, 4:{0,1}, 5:{0,2}, 6:{1,2}` (sherpa's mapping).
- Per frame: `argmax` over 7 classes → active local-speaker set.
- Per local speaker: contiguous active runs become turns with onset/offset 0.5,
  `min_duration_on = 0.3 s` (drop shorter), `min_duration_off = 0.5 s` (merge
  same-speaker turns closer than this). Frame `f` → time
  `f * 270/16000 + 991/16000 * 0.5` seconds, plus the window's sample offset.
- If no turns are found but the utterance has text, fall back to one turn over
  the whole utterance (preserves single-speaker behaviour).

### Module layout (`native/src/diarize/`)

- `segmentation.rs` — model load + windowed inference + powerset decode + turn
  extraction. New.
- `embedding.rs` — unchanged (embeds a PCM slice → 256-d).
- `registry.rs` — unchanged (online clustering).
- `mod.rs` — `SessionDiarizer::diarize(samples) -> Vec<SpeakerTurn{start_ms,
  end_ms, speaker_index}>`: segmentation → per-turn embed → registry. Replaces
  the old single-embedding `assign`.
- `alignment` (in `worker.rs`, pure fn) — assign each whisper `TranscriptSegment`
  the speaker of the turn with maximum temporal overlap; compute the dominant
  speaker (max attributed duration) for the utterance-level field.

## Contract changes

### Rust
- `protocol::TranscriptSegment` gains `speaker: Option<u32>` (wire
  `speaker: number | null`). Adapters set `None`; the worker fills it in.
- `Event::TranscriptReady.speaker_index` stays: now the utterance's **dominant**
  speaker (back-compat + single-speaker fallback). Per-segment speakers are the
  source of truth.
- Diarization `StageOutcome` payload gains `turnCount`.

### TypeScript
- `protocol.ts` / `session-journal.ts` `TranscriptSegment.speaker: number | null`
  (reconciles the unused `speaker?: string`).
- `TranscriptRevision` gains `spans: {speakerIndex: number | null; text: string}[]`
  derived from segments (consecutive same-speaker segments merged). One span
  (the whole text) when diarization is off or all segments share a speaker.
- Renderer composes the utterance block from spans: first span uses the normal
  pause-based boundary; subsequent spans start on a new line; a `**Speaker N:**`
  label is emitted whenever the span's speaker differs from the last *rendered*
  speaker (cross-span and cross-utterance). Single source of truth: a pure
  `composeSpans` used by both append and replace.

## LLM interaction

- Single-speaker utterances: per-utterance cleanup runs exactly as today; the
  cleaned text flows through the (single) span.
- Multi-speaker utterances: a single-text rewrite cannot be re-attributed across
  speakers without losing who-said-what, so per-utterance cleanup is **skipped**
  (not run — no wasted call); the labelled raw spans are rendered. Per-span
  cleanup is a documented follow-up.
- Batch whole-session rewrite stays best-effort over already-labelled text
  (unchanged documented limitation).

## Testing

- `segmentation`: powerset mapping table; `frames_to_turns` on synthetic frame
  activity (single speaker → one turn; A,B,A → three turns; min-duration drop;
  off-merge); provenance sha256/size; real two-voice concatenation → ≥2 turns.
- `alignment`: whisper-segment → turn overlap assignment; dominant speaker.
- `diarize` accuracy suite extended: a merged multi-speaker utterance now
  yields multiple correctly-attributed segments (was 1).
- Renderer: multi-span block (labels, newlines, cross-utterance suppression);
  single-span parity with today.
- e2e: AMI / synthetic conversation through the full pipeline shows turn-level
  attribution.

## Risks / mitigations

- Whisper segment granularity is coarser than turns → a segment spanning a turn
  goes to the dominant turn. Acceptable; token-level alignment is future work.
- Short turns → unreliable embeddings → the registry's short-turn guard attaches
  them to the nearest speaker rather than spawning spurious ones.
- Added per-utterance compute (one seg pass + N small embeds). Bounded: seg is a
  ~6 MB CPU model at ~0.05 s per 10 s window; stays well under real time.
