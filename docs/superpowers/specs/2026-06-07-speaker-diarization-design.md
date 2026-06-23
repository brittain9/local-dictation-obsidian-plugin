# Speaker Diarization — Design

- Status: accepted
- Date: 2026-06-07
- Issue: #75 ("Speaker diarization")
- Branch: `feat/speaker-diarization`

## Summary

Add local, privacy-preserving speaker diarization to the dictation pipeline.
When enabled, each finalized utterance is attributed to a session-stable
speaker, and the note renders a compact `**Speaker N:**` label whenever the
speaker changes. Diarization runs entirely in the Rust sidecar on audio the
worker already has, requires no accounts and no network, and keeps all
speaker data in memory for the duration of a session.

The core insight that keeps the design clean: **speaker identity is
per-utterance metadata that travels alongside the transcript text, never
inside it.** The hallucination filter and the LLM post-processor keep
operating on text, oblivious to speakers; the renderer composes the label at
write time.

## Goals

- Per-utterance speaker labels for multi-speaker capture (interviews,
  meetings, conversations).
- Session-stable identities: "Speaker 2" means the same person across the
  whole session.
- Works live: a speaker is assigned the moment an utterance finalizes, so
  labels appear with the normal per-utterance insertion.
- Fully local and private: no accounts, no network, no persisted voiceprints.
- Opt-in: off by default; personal single-speaker dictation is unaffected.

## Non-goals (v1)

- Intra-utterance speaker turns (one utterance is attributed to one speaker).
- Renaming speakers or persistent speaker profiles / enrollment.
- Diarizing imported audio files (the pipeline is live-capture only today).

## Background: the current pipeline

Audio (16 kHz mono) is framed and fed to Silero VAD in the sidecar. VAD
segments speech into utterances; each `FinalizedUtterance` (raw `samples`,
`vad_probabilities`, `voice_activity`, timing) is handed to the transcription
worker. The worker runs the engine (whisper), assembles a `Transcript`, runs
the post-engine text stages (currently the hallucination filter), and emits
`TranscriptReady`. The plugin receives it, optionally runs an LLM cleanup on
the **text**, and inserts the result into the note live, per utterance (a
whole-session batch rewrite is also available).

Two properties drive the design:

1. **The worker already holds per-session state and the utterance audio.**
   `WorkerSession` is the natural home for a speaker registry; the f32
   samples needed for an embedding are already in hand.
2. **Insertion is live and per-utterance.** A speaker must be assigned at
   finalize time, which requires *online/incremental* clustering — not
   whole-recording (offline) clustering.

## Engine decision

Chosen: **an online speaker-embedding registry implemented directly on the
existing `ort` (ONNX Runtime) dependency**, mirroring the existing Silero VAD
integration.

For each finalized utterance we compute one speaker embedding over its voiced
audio and match it against a session-scoped registry of speaker centroids
(cosine similarity, with hysteresis and a short-utterance guard). A match
reuses that speaker; a miss creates a new one. No segmentation model is
needed: Silero VAD already delimits the speech region, and v1 attributes one
speaker per utterance.

### Alternatives considered and rejected

- **`pyannote-rs` crate.** Pins `ort 2.0.0-rc.10`; this project pins
  `=2.0.0-rc.12` (a different native ONNX Runtime ABI — they will not unify
  and risk duplicate-symbol failures). It also vendors a C++ filterbank via
  CMake + bindgen. Both conflict with this repo's portable, pure-`ort`
  posture. Its successor benchmarks it at ~80% DER, so it is also not the
  accurate option it was once assumed to be.
- **`speakrs` crate.** Excellent (pins our exact `ort`, Apache-2.0,
  pyannote-level accuracy, pure-Rust pipeline) but it is a *whole-file*
  diarizer with global VBx clustering and a BLAS (Intel-MKL/OpenBLAS)
  dependency. Global clustering does not fit live per-utterance insertion.
  This is the right tool for a *future* "diarize an imported file" feature.
- **End-to-end streaming Sortformer (single ONNX).** One model, but a hard
  ≤4-speaker cap, redistribution-license questions for bundling, and a
  recurrent streaming state that wants an invasive frame-loop integration
  rather than the clean per-utterance worker hook.
- **`sherpa-onnx`/`sherpa-rs`.** Vendors a second ONNX Runtime in-process
  (conflicts with our `ort`) and clusters offline.

### Why the chosen approach

- Respects the `ort = =2.0.0-rc.12` pin; **no new dependencies**, no C++/CMake,
  no BLAS.
- Online/incremental clustering fits live insertion natively.
- Reuses the proven `vad.rs` pattern and the existing `ort`, `ndarray`,
  `realfft` infrastructure.
- Small, isolated, testable surface (~250–350 lines).

## Architecture

A new diarization step runs in the worker, **after** the post-engine text
stages and **before** the event is emitted. Running after the hallucination
filter means hallucinated/empty utterances never pollute the speaker registry
and we skip the work when no text survived.

```
audio frames → VAD → FinalizedUtterance{samples,…} → worker
  → engine (whisper) → segments + text
  → post-engine text stages (hallucination filter)          [text domain]
  → IF diarization enabled AND text survived:
       voiced PCM → fbank → embedding ONNX → registry match  [audio domain]
       → speaker_index, StageOutcome(Diarization)
  → emit TranscriptReady{ …, speakerIndex }
```

### New module: `native/src/diarize/`

- `fbank.rs` — Kaldi-style 80-dim log-Mel filterbank features
  (25 ms window / 10 ms shift, Povey window, per-utterance CMN), built on
  `realfft` + `ndarray`. Matches the bundled embedding model's expected
  front-end. (If a permissively-licensed embedding model with in-graph
  feature extraction is selected, this module collapses to a no-op.)
- `embedding.rs` — loads the bundled embedding ONNX via `ort`
  (`commit_from_memory`, as `vad.rs` does) and produces an L2-normalized
  embedding vector for a PCM slice.
- `registry.rs` — the online speaker registry: `HashMap<u32, Centroid>`,
  cosine assignment with thresholds and the short-utterance guard; returns a
  stable `speaker_index` and assignment diagnostics.
- `mod.rs` — `SessionDiarizer` ties the embedding extractor and registry
  together and exposes `assign(samples, vad_probabilities, voice_activity)`.

### Clustering rules

- **Match threshold** `T_match` (~0.5–0.7 cosine): assign to the nearest
  centroid above it.
- **Create hysteresis**: require similarity *below* a lower `T_new` to spawn a
  new speaker, so borderline clips attach to an existing speaker rather than
  over-splitting.
- **Short-utterance guard**: utterances with < ~1 s voiced audio never create
  a new speaker; they attach to the nearest existing centroid (or speaker 0
  when the registry is empty), because embeddings are unreliable on short
  clips.
- **Centroid update**: matched centroids update as a running (optionally
  confidence-weighted) mean.

Thresholds live in one small config struct with documented defaults; no user
setting in v1 beyond the on/off toggle.

## Contract / protocol changes

Speaker identity is a single optional field that rides the existing
transcript through every layer.

### Sidecar (Rust)

- `protocol.rs`
  - `enum StageId` gains `Diarization`.
  - `Event::TranscriptReady` gains `speaker_index: Option<u32>`
    (wire `speakerIndex: number | null`; 0-based; `null` when diarization is
    off or unassigned). Serialized as JSON `null` (not omitted), matching the
    repo's existing optional-field contract.
  - `Command::StartSession` gains `diarization_enabled: bool`
    (`#[serde(default)]`, default `false`).
- `stages/mod.rs`: `StageEnablement` gains `diarization: bool`.
- `worker.rs`
  - `SessionMetadata` carries `diarization_enabled`.
  - `WorkerSession` gains `diarizer: Option<SessionDiarizer>` (constructed at
    `BeginSession` when enabled; dropped at `EndSession`, discarding all
    embeddings).
  - `WorkerEvent::TranscriptReady` gains `speaker_index: Option<u32>`.
  - The diarization step records a `StageOutcome { stage_id: Diarization, … }`
    with a payload of `{ speakerIndex, similarity, isNewSpeaker, speakerCount }`
    for the existing stage-timeline UI.
- `app.rs`: thread `diarization_enabled` from `StartSession` into
  `SessionMetadata`; map `WorkerEvent::TranscriptReady.speaker_index` into
  `Event::TranscriptReady.speaker_index`.

### Plugin (TypeScript)

- `sidecar/protocol.ts`: `TranscriptReadyEvent.speakerIndex: number | null`;
  `StartSessionCommand.diarizationEnabled: boolean`.
- `session/session-journal.ts`: `StageId` gains `'diarization'`;
  `TranscriptRevision` gains `speakerIndex: number | null`.
- `dictation/dictation-session-controller.ts`: snapshot
  `diarizationEnabled`; pass it to `startSession`; thread `speakerIndex`
  through `toTranscriptRevision`.
- `transcript/renderer.ts`: inject the speaker label (see UX).
- `settings/plugin-settings.ts`: `diarizationEnabled: boolean` (default
  `false`); settings-tab toggle.

## Interaction with the other stages

- **Hallucination filter** stays text-only. Diarization runs after it and is
  skipped entirely for dropped/empty utterances, so hallucinations cannot
  create phantom speakers.
- **LLM (off or per-utterance)**: transforms only the text; the renderer
  attaches `Speaker N:` at write time. The LLM never sees or needs speaker
  data — consistent with the requirement that the LLM need not preserve
  labels.
- **LLM (batch, whole-session rewrite)**: labels are already present in the
  note text before the rewrite; the rewrite is best-effort over them. This is
  a documented limitation, acceptable because label preservation is not
  required of the LLM.

## UX / rendering

- Format: inline bold prefix, `**Speaker N:** <text>` (N = `speakerIndex + 1`).
- Visibility: shown **only on speaker change**; the first utterance of a
  session is always labeled. A single-speaker session therefore shows one
  `**Speaker 1:**` at the top and then clean text.
- The renderer/journal tracks the last rendered speaker per session and
  composes the speaker label with the existing timestamp prefix.

## Privacy

- Embeddings and centroids exist only in the in-memory `SessionDiarizer` and
  are destroyed when the session ends.
- No enrollment, no persisted voiceprints, no disk writes, no network, no
  accounts. Labels are generic ("Speaker 1/2/3").

## Models & bundling

- One speaker-embedding ONNX model, bundled via `include_bytes!` with a
  `native/models/speaker_embedding.provenance.json` manifest, exactly as
  Silero VAD is bundled and provenance-checked today.
- Selection criteria: permissive license (Apache-2.0 wespeaker/3D-Speaker
  family), compact (target ≤ ~15 MB, int8 acceptable), and a documented
  feature front-end the `fbank` module can match. The exact artifact, its
  sha256, and size are pinned in the provenance manifest at implementation
  time and asserted by a test (mirroring the Silero provenance test).

## Scope, limitations, future work

- v1 attributes one speaker per utterance; an utterance containing two
  speakers with no intervening pause is attributed to the dominant one. Adding
  the pyannote `segmentation-3.0` model later enables intra-utterance turns.
- Online clustering cannot retroactively merge two early centroids that later
  prove to be one speaker; a periodic centroid-merge pass and/or an
  end-of-session re-cluster are possible future refinements.
- Renaming and persistent speaker profiles are deferred.
- File-import diarization (a `speakrs`-based batch path) is deferred.

### Overlap-aware diarization (planned)

Overlapping speech and reliable intra-utterance turns require a *segmentation*
model; the embedding model alone cannot detect them (the literature is explicit
that a plain segmentation→embedding→clustering pipeline needs a dedicated
overlap-detection + overlap-assignment stage). The path that stays on the
existing `ort` runtime and our privacy/bundling constraints:

1. Bundle pyannote `segmentation-3.0.onnx` (~6 MB, permissive, runs on `ort`).
   Per 10 s window it emits a per-frame **powerset** distribution over
   `{∅, s1, s2, s3, s1+s2, s1+s3, s2+s3}`; the combination classes are overlap
   (≤3 speakers/chunk, 2/frame).
2. Decode powerset → per-frame local speaker activity, stitched across windows.
3. Tiers, in increasing cost:
   - **Turn splitting (single-label).** Split a VAD utterance at local speaker
     changes into homogeneous sub-segments, embed and cluster each. Fixes the
     "rapid back-and-forth merged into one utterance" case — the highest
     practical value for meetings, and it keeps speaker assignment single-valued.
   - **Overlap flagging.** Mark frames the powerset reports as two speakers
     (e.g. a `[crosstalk]` marker / segment flag) without resolving who.
   - **Overlap assignment (multi-label).** Assign both speakers to overlapped
     frames, embedding each track via the segmentation masks.
4. Contract impact: speaker identity moves from the utterance to the *segment*
   level, and true overlap makes it multi-valued — `TranscriptSegment.speaker`
   (plus a small `speakers: Vec<u32>` for overlapped frames) rather than one
   `speakerIndex` per utterance. The renderer would group consecutive
   same-speaker segments under one label.
5. Validation needs real labelled multi-speaker audio (DER on a held-out clip)
   and threshold tuning, so this work is gated on a test set rather than landed
   blind.

## Testing strategy

- `fbank`: shape, determinism, and parity against a known reference vector for
  a fixed input.
- `registry`: same speaker → same id; distinct speakers → distinct ids;
  short-utterance guard does not spawn speakers; hysteresis prevents
  over-splitting on borderline similarity.
- Protocol round-trips (Rust + TS): `speakerIndex` present/`null`,
  `diarizationEnabled` default, `Diarization` stage id.
- Worker: `speaker_index` is `null` when disabled and after a fully-filtered
  utterance; populated and registry-stable across utterances when enabled.
- Renderer: label on first utterance, suppressed on same-speaker repeats,
  shown on change, composed with timestamps.
- Model provenance test asserting the bundled artifact's sha256/size.
