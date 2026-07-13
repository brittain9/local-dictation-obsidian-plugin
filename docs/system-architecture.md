# System Architecture

Local Dictation is an Obsidian plugin that turns speech into text entirely
on-device. Audio flows from a capture source through a browser audio layer,
across a binary protocol into a native Rust sidecar, and back as a transcript
that the plugin renders into the active editor.

The split is deliberate:

- **The plugin (TypeScript, `src/`)** owns Obsidian UX — capture, settings,
  orchestration, the optional LLM transform, rendering, and editor insertion.
- **The sidecar (Rust, `native/`)** owns everything between "audio in" and
  "transcript out" — voice-activity detection, inference, the post-engine stage
  chain, and optional speaker diarization.

```mermaid
flowchart LR
    subgraph Plugin ["Obsidian plugin (TypeScript)"]
        CAP["Audio capture<br/>(mic / system audio → PCM)"]
        CFG["Session config + commands"]
        LLM["LLM transform<br/>(optional · Ollama / OpenRouter)"]
        REND["Render + insert<br/>(timestamps, formatting, speaker labels)"]
    end

    subgraph Sidecar ["Native sidecar (Rust)"]
        VAD["VAD · speech boundaries"]
        INF["Inference · engine registry"]
        STAGE["Post-engine stages<br/>(hallucination filter)"]
        DIA["Diarization<br/>(optional)"]
        VAD --> INF --> STAGE --> DIA
    end

    CAP -->|"stdin: audio frames"| VAD
    CFG -->|"stdin: JSON commands"| VAD
    DIA -->|"stdout: transcript_ready"| LLM --> REND
```

The plugin and sidecar talk over a single framed byte stream on the sidecar's
stdin/stdout. Audio frames and JSON commands share stdin; JSON events come back
on stdout. `transcript_ready` carries revisioned text. Batch families emit one
final revision per utterance; streaming families can emit changed partial
revisions before the final. LLM transforms and editor rendering remain plugin
concerns.

---

## Pipeline Stages

### Stage 1: Audio Capture

```mermaid
flowchart LR
    SRC["Microphone or<br/>system audio"] --> RT["Real-time audio thread<br/>(resample + quantize)"]
    RT --> MAIN["Main thread<br/>(frame + encode)"]
    MAIN -->|"stdin (binary protocol)"| SIDECAR["Sidecar"]
```

Captures raw audio, resamples to 16 kHz, quantizes to 16-bit PCM, and packages
it into fixed 640-byte frames at 50 fps.

- **Microphone** capture runs in the plugin via the Web Audio API. An
  `AudioWorklet` runs on a dedicated real-time thread; `PcmFrameProcessor` does
  linear-interpolation resampling from the browser's native rate (44.1/48 kHz)
  down to 16 kHz.
- **System audio** (this computer's output) is captured natively by the sidecar
  on Windows (WASAPI loopback), Linux (the default PulseAudio/PipeWire monitor),
  and macOS 14.2+ (CoreAudio process taps attached to a private aggregate
  device). It is optional and graceful — if the platform's audio stack is
  unavailable the source is simply hidden.

**PCM format** (shared constants, identical in TS and Rust):

| Parameter | Value |
|-----------|-------|
| Sample rate | 16,000 Hz |
| Channels | 1 (mono) |
| Bit depth | 16-bit signed LE (Int16) |
| Frame duration | 20 ms |
| Samples per frame | 320 |
| Bytes per frame | 640 |

This stage is effectively real-time and never a bottleneck (~3-6 ms AudioContext
latency plus 20 ms frame accumulation).

---

### Stage 2: Binary Protocol Transport

```mermaid
sequenceDiagram
    participant P as Plugin
    participant S as Sidecar

    Note over P,S: stdin — audio frames + JSON commands
    Note over P,S: stdout — JSON events only

    P->>S: audio frame
    P->>S: start_session
    S->>P: session_started
    S->>P: session_state_changed
    P->>S: audio frame
    S->>P: transcript_ready
```

The sidecar is spawned as a subprocess of Obsidian (`child_process.spawn`,
`stdio: 'pipe'`). A custom 5-byte framing header (1 byte kind + 4-byte LE length
+ payload) multiplexes JSON and raw audio on one bidirectional stream — no HTTP,
no WebSocket, no IPC library. `FramedMessageParser` (TS) and `read_frame` (Rust)
reassemble frames across chunk boundaries.

- `stdin` (TS → Rust): audio frames (`0x02`) and JSON command frames (`0x01`).
- `stdout` (Rust → TS): JSON event frames (`0x01`) only.

**Commands (TS → Rust):**

| Command | Purpose |
|---------|---------|
| `health` | Liveness ping |
| `get_system_info` | Enumerate compiled runtimes and family adapters with static capabilities |
| `start_session` | Begin transcription (model, mode, sessionId, options) |
| `stop_session` | Graceful stop (drain pending transcriptions) |
| `cancel_session` | Immediate cancel (discard pending) |
| `context_response` | Reply to a `context_request` with the plugin-assembled context window |
| `shutdown` | Hard process exit; call `stop_session` first to drain |
| `get_model_store` | Query the model store path |
| `list_model_catalog` | Fetch the built-in model catalog |
| `list_installed_models` | List locally installed models |
| `probe_model_selection` | Check whether a model selection is usable |
| `install_model` | Start a model download + install |
| `cancel_model_install` | Cancel a pending install |
| `remove_model` | Delete an installed model |

**Events (Rust → TS):**

| Event | Purpose |
|-------|---------|
| `health_ok` | Health reply with version |
| `system_info` | Compiled runtimes + adapters with declared capabilities |
| `session_started` | Session confirmed active |
| `session_state_changed` | State-machine transition |
| `audio_level` | Periodic input level for the meter |
| `transcript_ready` | Transcript revision: `isFinal`, monotonic `revision`, segments, timing, `stageResults[]`, and `warnings[]` |
| `transcription_queue_changed` | Back-pressure queue depth changed |
| `context_request` | Sidecar asks the plugin for context for the next utterance |
| `session_stopped` | Session ended, with reason |
| `warning` | Non-fatal warning |
| `error` | Fatal error |
| `model_store` | Model store path info |
| `model_catalog` | Full catalog payload |
| `installed_models` | Installed model list |
| `model_probe_result` | Availability check + merged capabilities for the selection |
| `model_install_update` | Install progress |
| `model_removed` | Deletion confirmation |

Transport latency is sub-millisecond per frame; the main loop polls at 10 ms.

---

### Stage 3: Speech Boundary Detection

```mermaid
stateDiagram-v2
    direction LR

    [*] --> Listening : start
    Listening --> SpeechDetected : sustained speech
    SpeechDetected --> SpeechEnding : speech probability drops
    SpeechEnding --> SpeechDetected : speech resumes
    SpeechEnding --> Listening : silence window reached · utterance finalized
    SpeechDetected --> Listening : max length · boundary-aware split
    Listening --> [*] : stop
    SpeechDetected --> [*] : stop + flush
    Listening --> Timeout : one_sentence timeout
```

Receives 20 ms PCM frames, runs voice-activity detection on each, and uses a
state machine to detect speech boundaries and package completed utterances.

- **Silero VAD** (ONNX via the `ort` crate) returns a speech probability
  (0.0–1.0) per 512-sample (32 ms) window. The detector buffers 20 ms pipeline
  frames, carries 64 samples of context forward, and threads a `[2, 1, 128]` RNN
  state across inferences.
- A **preset-driven state machine** (`session.rs`) owns the tuning. The user
  picks a named speaking style; hysteresis (the end threshold sits 0.15 below the
  start threshold, floored at 0.05) plus a min-speech gate reject transients, and
  a pending-end timer fires finalization.

**Speaking-style presets** (Rust-authoritative):

| Preset | `speech_threshold` | `min_speech_frames` | `silence_end_frames` |
|---|---|---|---|
| Responsive | 0.40 | 3 (60 ms) | 20 (400 ms) |
| Balanced (default) | 0.50 | 5 (100 ms) | 50 (1000 ms) |
| Patient | 0.55 | 6 (120 ms) | 100 (2000 ms) |

The silence windows track industry streaming-dictation norms: 400 ms
(AssemblyAI Streaming v2's legacy end-of-turn), 1000 ms (AssemblyAI
Universal-Streaming / Deepgram end-of-speech), and 2000 ms (near Azure dictation
territory for long pauses).

**Finalization paths:**
1. **Natural end** — probability drops below the negative threshold; once the
   silence gap reaches `silence_end_frames`, the utterance is trimmed and
   finalized.
2. **Boundary-aware split** — at the 30 s hard cap (`MAX_UTTERANCE_FRAMES`), the
   session cuts at the most recent silence boundary if one is recent enough, else
   falls back to a hard cut, and keeps the tail running.
3. **Graceful stop** — on user stop, any pending utterance is emitted before the
   session stops.

Each finalized utterance carries `VoiceActivityEvidence` (audio/speech bounds,
voiced/unvoiced duration, mean/max probability) derived from the same frames sent
to inference. The per-frame Silero trace also reaches downstream stages as a
borrowed slice, so processors that need sub-utterance resolution can compute
per-segment voiced fraction without re-running VAD.

For a streaming family, the session also forwards PCM while the VAD utterance
is open. VAD still owns the boundary and authoritative final clip. If trailing
silence or a boundary-aware split makes the live PCM differ from that clip, the
worker resets and replays the final clip before final decode.

The perceived end-of-speech delay is the preset's silence window
(400–2000 ms); Silero inference itself is ~1 ms amortised per 20 ms frame.

---

### Stage 4: Inference

```mermaid
flowchart LR
    PCM["Open utterance PCM<br/>(streaming families)"] --> WORKER
    UTT["Completed utterance<br/>(all families)"] --> WORKER

    subgraph WORKER ["Worker thread"]
        direction TB
        LOOKUP["Engine registry lookup<br/>(runtime / family adapter)"]
        GATE["Capability gate<br/>(warn + drop unsupported fields)"]
        INF["LoadedModel · batch<br/>StreamingModel · incremental"]
        LOOKUP --> GATE --> INF
    end

    WORKER --> OUT["Transcript segments"]
```

Looks up the family adapter for the session's `(runtimeId, familyId)`, drops any
request fields the adapter doesn't support (emitting `RequestWarning[]`), runs
the model, and produces timestamped text segments.

**Three-layer engine abstraction:**

| Layer | Trait | Owns |
|---|---|---|
| Runtime | `Runtime` | Execution framework: accelerator probe, supported model formats |
| Family adapter | `ModelFamilyAdapter` | Model shape: graph I/O, tokenizer, prompt tokens, audio limits, probe rules |
| Loaded batch model | `LoadedModel` | Per-session batch inference state; `transcribe(&TranscriptionRequest)` |
| Loaded streaming model | `StreamingModel` | Per-utterance PCM acceptance, partial decode, final decode, reset |

`EngineRegistry::build()` is the single registration site. Worker dispatch uses
`adapter.load → loaded.transcribe` for batch families and
`adapter.load_streaming → accept_audio / partial / finalize_utterance` for a
streaming family.
Capabilities reach the plugin two ways: inventory (`system_info`) and
per-selection merge (`model_probe_result.mergedCapabilities`). Each runtime probes
its accelerators at startup — `whisper_cpp` checks for a usable Metal or CUDA
device, `onnx_runtime` tries to register the ONNX Runtime CUDA provider — and
reports what's actually available.

**Compiled runtimes and adapters:**

| Runtime | Crate | Model format | Adapter |
|---|---|---|---|
| `whisper_cpp` | whisper-rs (whisper.cpp) | GGML `.bin` | `whisper` |
| `onnx_runtime` | ort (ONNX Runtime) | ONNX / ORT | `cohere_transcribe`, `moonshine` |

Cargo features: `engine-whisper`, `engine-cohere-transcribe`,
`engine-moonshine`, `gpu-metal`, `gpu-cuda`, `gpu-ort-cuda`. A missing
`(runtimeId, familyId)` pair surfaces as an `unsupported_engine` error rather
than a silent failure.

**Worker behavior:**
- A dedicated thread holding `Arc<EngineRegistry>`, communicating over `mpsc`
  channels; all inference is synchronous and blocking on that thread.
- Whisper runs greedy decoding, English-only, with `use_gpu`/`flash_attn` from
  the acceleration config. The model context persists across utterances and
  reloads only on a path or GPU-config change.
- Moonshine keeps frontend, encoder, adapter, cross-attention, and decoder KV
  state for the open utterance. It attempts a changed-text partial every 500 ms;
  the single worker thread guarantees one decode in flight, and the wall-time
  gate drops catch-up partials while preserving all PCM for the next decode.
- Partials carry only the engine stage outcome. Finals run the normal post-engine
  chain and receive a revision greater than every emitted partial.
- Back-pressure: finalized utterances queue while inference is in flight; queue
  tiers are reported, and the session stops at a hard cap rather than silently
  dropping audio.
- Panic safety: `catch_unwind` wraps model load and inference; panics become
  `error` events instead of crashing the sidecar.

**Available models:**

| Model | Runtime · Family | Quant | Size | Notes |
|-------|--------|-------|------|-------|
| Whisper Tiny EN | `whisper_cpp` · `whisper` | Q8_0 | 42 MB | Fastest, lowest quality |
| Whisper Base EN | `whisper_cpp` · `whisper` | Q8_0 | 78 MB | |
| Whisper Small EN | `whisper_cpp` · `whisper` | Q5_1 | 181 MB | Balanced |
| Whisper Medium EN | `whisper_cpp` · `whisper` | Q5_0 | 514 MB | |
| Whisper Large V3 Turbo | `whisper_cpp` · `whisper` | Q8_0 | 834 MB | Best with GPU |
| Cohere Transcribe FP16 | `onnx_runtime` · `cohere_transcribe` | FP16 | 3.8 GB | 2B params |
| Cohere Transcribe INT8 | `onnx_runtime` · `cohere_transcribe` | INT8 | 2.9 GB | |
| Cohere Transcribe Q4 | `onnx_runtime` · `cohere_transcribe` | Q4 | 2.0 GB | |
| Moonshine Tiny | `onnx_runtime` · `moonshine` | Quantized | 49 MB | Streaming (live), 34M params |
| Moonshine Small | `onnx_runtime` · `moonshine` | Quantized | 157 MB | Streaming (live), balanced, 123M params |
| Moonshine Medium | `onnx_runtime` · `moonshine` | Quantized | 289 MB | Streaming (live), 245M params |

Moonshine models are streaming (live-dictation) entries in the managed catalog,
installed through Manage Models like any other model. Each is a multi-file ORT
asset set (frontend, encoder, adapter, cross/decoder KV, streaming config, and
tokenizer) fetched from Moonshine AI and verified against pinned sizes and
SHA-256 hashes. They are English-only and do not apply speaker labels. See
[`docs/guides/moonshine-live-testing.md`](guides/moonshine-live-testing.md) for
install and manual acceptance testing.

**Inference is the bottleneck.** Time depends on model size, hardware, and
utterance length, and is reported as `processing_duration_ms` on each transcript.
Typical for a ~3 s utterance: Whisper Tiny ~200-500 ms (CPU); Whisper Small
~1-3 s (CPU) or ~200-500 ms (Metal/CUDA); Large V3 Turbo ~2-5 s (Metal/CUDA). On
smaller models the user is usually still pausing when inference completes, so the
silence window hides most of the latency.

---

### Stage 5: Post-Engine Stages

After final inference, a chain of post-engine processors runs in canonical order
on the finalized transcript. Streaming partials bypass this chain entirely.
Each final stage may rewrite or drop segments but is validated against the prior
revision: it must not move timing boundaries, overlap segments, or run past the
utterance duration. A panicking stage is caught and recorded as
`Failed`; the chain continues. Every stage records a `StageOutcome`
(`Ok` / `Skipped` / `Failed` with revision and payload), and the full history
ships in `transcript_ready.stageResults[]`.

**Registered today:** the **hallucination filter** — a conservative filter that
drops whole hallucinated segments while preserving timing. Hard text artifacts
(empty text, punctuation-only output, known non-speech tags, caption/source
attributions) can drop on text alone; soft artifacts (courtesy endings, CTAs,
bare `you`, URL-like text) require corroborating model or VAD evidence. It
combines Whisper/Cohere decoder diagnostics with per-segment voiced fraction and
utterance-level VAD evidence. If nothing is dropped it records
`Skipped { reason: "no_hallucinations" }`.

`StageId::Punctuation` and `StageId::UserRules` exist as reserved identifiers but
have no registered processor yet.

---

### Stage 6: Diarization (optional)

When speaker diarization is enabled, it runs in the worker after the text stages,
on the finalized utterance's audio:

```mermaid
flowchart LR
    UTT["Finalized utterance audio"] --> SEG["Segmentation<br/>(turn boundaries)"]
    SEG --> EMB["Embedding<br/>(per turn)"]
    EMB --> REG["Session registry<br/>(stable speaker index)"]
    REG --> LBL["Speaker labels on segments"]
```

A single VAD utterance can contain more than one speaker, so segmentation finds
*where* speakers change, embedding + a session-scoped registry decide *who* they
are, and the worker aligns transcript segments to those turns. Speaker indices
stay stable across the session because turns reconcile by voice.

By default, a sufficiently distinct long turn may create another session
speaker. When `diarizationMaxSpeakers` is set and the registry reaches that
count, subsequent turns attach to the nearest existing centroid instead. This
prevents known two-person recordings from accumulating extra labels, at the
explicit cost of merging a real additional speaker if the configured limit is
too low.

All speaker data lives in memory for the session and is discarded when it ends —
no enrollment, no persisted voiceprints, no network. The bundled models are
`pyannote/segmentation-3.0` (MIT) and `wespeaker_en_voxceleb_resnet34_LM`
(CC-BY-4.0); see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Streaming sessions do not run diarization in this version. A requested
`diarizationEnabled` value is ignored and reported in the transcript's
capability warnings.

---

### Stage 7: Transform, Render, Insert (plugin)

The plugin consumes every accepted `transcript_ready` revision:

1. **LLM transform (optional, off by default).** Final revisions can be cleaned,
   rewritten, or summarized per utterance — or the whole session in batch —
   through a local model
   (Ollama) or OpenRouter. Routing is `local` by default; with remote enabled,
   jobs over a configurable character threshold can auto-route to OpenRouter.
   Audio is never sent; only the transcript text and any note context you opt in
   to. Lives in `src/llm/`.
2. **Render.** The transcript renderer (`src/transcript/renderer.ts`) applies the
   user's formatting (`smart` / `space` / `new_line` / `new_paragraph`), optional
   elapsed- or wall-clock timestamps, and speaker labels.
3. **Insert or revise.** The first revision lands at the dictation anchor;
   later revisions compare-and-swap the tracked utterance span. Non-final text
   has a theme-neutral provisional opacity decoration. A user edit latches the
   span, clears the decoration, and prevents all later model revisions from
   overwriting it. Final, latch, and session teardown all clear provisional
   state.

---

## Plugin Orchestration

### Listening Modes

| Mode | Behavior | Auto-stop |
|------|----------|-----------|
| `one_sentence` | Capture one utterance, transcribe, stop | Yes (first transcript or 10 s timeout) |
| `always_on` (default) | Continuous capture, transcribe every utterance | No (manual stop) |

### Ribbon States

The ribbon mic reflects the capture state: `idle` (click to start), `starting`,
`listening`, `speech_detected` (hearing speech), and `error`. Transcription
happens in the background without blocking capture, so there is no separate
"transcribing" ribbon state.

### Editor Target Ownership

A dictation session resolves the exact CodeMirror editor that owns its target
and, when possible, temporarily pins that Markdown leaf. The lease lasts until
accepted transcripts and optional batch cleanup finish, so ordinary navigation
opens elsewhere instead of displacing the note receiving text. User pin changes
always take precedence over plugin ownership.

If the exact target leaf closes or is replaced, the controller cancels the
session and discards later transcript events. If an external edit makes a
tracked insertion position unmappable, the note surface returns a typed terminal
outcome and clears plugin decorations rather than clamping or guessing a new
position. Both paths preserve the note and produce one actionable recovery
message.

### Settings

A representative slice of user-facing settings (full list and defaults in
`src/settings/plugin-settings.ts`):

| Setting | Default | Purpose |
|---------|---------|---------|
| `listeningMode` | `always_on` | Dictation trigger behavior |
| `speakingStyle` | `balanced` | VAD preset (Responsive / Balanced / Patient) |
| `selectedModel` | `null` | Active model selection |
| `accelerationPreference` | `auto` | GPU when available vs CPU-only |
| `includeSystemAudio` | `false` | Capture system output instead of the mic |
| `diarizationEnabled` | `false` | Label speakers (Speaker 1, 2, …) |
| `diarizationMaxSpeakers` | `null` | Optional positive cap on session-stable speaker labels; `null` detects automatically |
| `dictationAnchor` | `at_cursor` | Where transcript text lands (`at_cursor` / `end_of_note`) |
| `transcriptFormatting` | `smart` | How utterance boundaries render |
| `timestampsEnabled` | `false` | Render timestamps in the note |
| `timestampClock` | `elapsed` | `elapsed` session time vs `wallclock` |
| `timestampDensity` | `sparse` | `sparse` (interval) vs `every_utterance` |
| `llmPostprocessMode` | `off` | LLM transform: `off` / `per_utterance` / `batch` |
| `llmRouting` | `local` | `local` (Ollama) vs `remote` (OpenRouter) |
| `llmRemoteThresholdChars` | `6000` | Size above which jobs auto-route to OpenRouter |
| `sidecarRequestTimeoutSeconds` | `300` | Command/response timeout |
| `sidecarStartupTimeoutSeconds` | `4` | Health-check timeout on launch |
| `developerMode` | `false` | Verbose logging |

---

## Technology Reference

| Technology | Role in the system |
|------------|--------------------|
| **Obsidian Plugin API** | Host runtime: editor access, commands, settings, UI hooks |
| **Web Audio API / AudioWorklet** | Microphone capture and PCM frame production at 50 fps |
| **whisper-rs / whisper.cpp** | Primary engine; runs GGML-quantized Whisper on CPU, Metal, or CUDA |
| **ort (ONNX Runtime)** | Engine for Cohere Transcribe and Moonshine; also runs Silero VAD and diarization models |
| **Silero VAD** | Speech probability per 32 ms window; drives boundary detection |
| **Node.js child_process** | Spawns and manages the Rust sidecar |
| **reqwest + sha2** | Downloads model files and verifies their SHA-256 |
| **Ollama / OpenRouter** | Optional LLM transform (local / remote) on the plugin side |

## Where Things Live

- **Sidecar binary:** `.obsidian/plugins/local-dictation/bin/<variant>/`
  (`cpu`, `cuda`), installed by the plugin from the matching GitHub Release.
- **Models:** outside the vault, in the user data directory, so they aren't
  duplicated per-vault:
  - Windows: `%LOCALAPPDATA%\obsidian-local-stt\models`
  - macOS: `~/Library/Application Support/obsidian-local-stt/models`
  - Linux: `~/.local/share/obsidian-local-stt/models`
