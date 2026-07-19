# Local TTS Landscape — Research for a "Read Note Aloud" Feature (July 2026)

Research date: 2026-07-18. All claims cite primary sources (official repos, model cards, docs)
verified on this date unless explicitly marked otherwise. Secondary sources (leaderboard
summaries) are flagged where used.

Context: this plugin is MIT-licensed, ships a Rust sidecar binary (whisper.cpp + Moonshine),
targets Linux/macOS/Windows, and has an existing model-catalog/download UX. TTS candidates are
evaluated against that architecture.

---

## Executive summary

The 2025–2026 period transformed local TTS. Three developments matter most for this plugin:

1. **The small-model CPU tier got genuinely good.** Kokoro-82M (Apache-2.0, 8 languages)
   remains the quality/size benchmark; new 2026 entrants — Kyutai **Pocket TTS** (100M, MIT
   code / CC-BY-4.0 weights, native streaming, CPU 6× real-time), Supertone **Supertonic**
   (~99M ONNX, 31 languages, official Rust implementation), and **KittenTTS** (15–80M,
   Apache-2.0) — all run comfortably in real time on modest laptop CPUs.
2. **The runtime story converged on sherpa-onnx.** k2-fsa's sherpa-onnx (Apache-2.0) now runs
   seven TTS families — VITS/Piper, Matcha, Kokoro, KittenTTS, ZipVoice, PocketTTS,
   SupertonicTTS — behind one C API with official Rust bindings and chunked-callback synthesis
   (`GenerateWithCallback`), i.e., one dependency can serve a whole TTS model catalog the same
   way whisper.cpp serves the STT catalog. https://k2-fsa.github.io/sherpa/onnx/tts/index.html
3. **Licensing is a minefield of near-misses.** Several famous names are unusable or
   encumbered: XTTS-v2 (CPML, non-commercial), F5-TTS weights (CC-BY-NC), Fish/OpenAudio
   S1-mini (CC-BY-NC-SA, gated) and S2-Pro (non-commercial research license), Piper (now
   GPL-3.0 under the Open Home Foundation). Separately, the **espeak-ng phonemizer (GPLv3)**
   is a transitive dependency of most small phoneme-based models (Piper, Kokoro, KittenTTS,
   Zonos) — see the licensing section for what that means for an MIT sidecar.

### Shortlist recommendation (tiered, mirroring the STT catalog)

| Tier | Model | Why |
|---|---|---|
| Default (CPU, fast) | **Kokoro-82M** via ONNX (sherpa-onnx or kokoro-onnx assets) | Best quality-per-MB in the ecosystem, Apache-2.0 weights, 54 voices / 8 languages, proven Rust paths. Caveat: espeak-ng (GPL) phonemization for full language coverage. |
| Multilingual breadth (CPU, fast) | **Supertonic** (~99M) | 31 languages, 44.1 kHz output, official Rust reference implementation, ONNX-native, no espeak-ng. Caveat: weights are OpenRAIL-M (commercial OK, use restrictions). |
| Streaming / premium voices | **Pocket TTS** (Kyutai, 100M) | Jan 2026 release; native chunked streaming (~200 ms first audio), voice cloning, 6 languages (May 2026), MIT code + CC-BY-4.0 weights, Rust/candle crate and sherpa-onnx support. Caveat: official HF repo is gated (CC-BY allows re-hosting). |
| High-quality GPU tier (optional) | **Qwen3-TTS 0.6B** (Apache-2.0) or **Chatterbox Multilingual** (MIT) | Near-frontier naturalness, 10 / 23 languages, voice cloning; both are Python/PyTorch-first, so integration cost is much higher — treat as a later phase, not the MVP. |

Recommended MVP: sherpa-onnx as the single TTS runtime in the sidecar, offering Kokoro
(quality default) + Supertonic (language breadth) + optionally KittenTTS (tiny). This reuses
the existing model-download UX, works on CPU everywhere, and keeps one integration surface.
The espeak-ng GPL question must be resolved first (options below).

---

## Per-model detail

### Kokoro-82M (hexgrad)

- **Quality**: Reached #1 on TTS Spaces Arena at launch (v0.19) despite 82M params; on the
  Artificial Analysis arena it sits mid-table overall but is the top small open model
  (reported Elo ≈ 1056, rank ~32 of 88, with one of the largest sample sizes — secondary
  source, see caveat below). Widely regarded as the best sub-100M model.
  https://huggingface.co/hexgrad/Kokoro-82M
- **Languages**: 8 — American + British English, Japanese, Mandarin, Spanish, French, Hindi,
  Italian, Brazilian Portuguese; 54 voices in v1.0 (v1.1-zh adds more Chinese speakers).
  https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
- **Size / hardware**: 82M params. ONNX exports: 310 MB fp32 / 169 MB fp16 / 88 MB int8;
  near-real-time or faster on Apple-silicon-class CPUs.
  https://github.com/thewh1teagle/kokoro-onnx
- **License**: Apache-2.0 (weights and code). https://huggingface.co/hexgrad/Kokoro-82M
- **Rust integration**: first-class — sherpa-onnx has Kokoro support (v0.19 en, v1.0/v1.1
  multi-lang packages); community `kokoro-onnx` (Python) and pure-Rust ports (e.g.
  rishiskhare/tts-rs) exist. https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html
- **Phonemizer**: uses **misaki** G2P (Apache-2.0, Python; native EN/JA/KO/ZH/VI) with
  **espeak-ng fallback** for out-of-dictionary words and non-misaki languages (es/fr/hi/it/pt
  go through espeak in practice). sherpa-onnx's Kokoro packages bundle `espeak-ng-data`.
  https://github.com/hexgrad/misaki ; GPL concern thread:
  https://github.com/hexgrad/kokoro/issues/247 ; a `misaki-rs` Rust crate exists
  (https://crates.io/crates/misaki-rs) — maturity unverified.
- **Voices/control**: 54 voices, speed control; no voice cloning.
- **Maintenance**: v1.0 Jan 2025; HF repo last updated Nov 2025; no v2 announced as of
  2026-07-18 (searched; nothing found). Stable rather than fast-moving.

### Pocket TTS (Kyutai) — new, Jan 2026

- **Quality**: "production-grade" claim from Kyutai; no arena placement found (too new).
  Subjectively positioned above Piper/Kitten class. Not independently benchmarked — unverified.
- **Languages**: English at launch; +French, German, Spanish, Portuguese, Italian (May 2026,
  larger 24-layer variants for non-English).
  https://kyutai.org/blog/2026-01-13-pocket-tts/ ,
  https://kyutai.org/blog/2026-05-04-pocket-tts-multilingual/
- **Size / hardware**: 100M params; ~6× real-time on 2 cores of a MacBook Air M4; ~200 ms to
  first audio. https://github.com/kyutai-labs/pocket-tts
- **License**: code MIT; **weights CC-BY-4.0** on a **gated** HF repo (contact-info gate).
  CC-BY permits redistribution/commercial use with attribution, so the gate is a distribution
  friction, not a legal blocker; sherpa-onnx already redistributes converted models. A
  separate `kyutai/pocket-tts-without-voice-cloning` repo exists (presumably ungated;
  purpose unverified). https://huggingface.co/kyutai/pocket-tts
- **Rust integration**: excellent — sherpa-onnx PocketTTS support; a Rust/candle crate
  (`pocket-tts` on crates.io/lib.rs, WASM + PyO3 bindings); a Rust WASM port by
  LaurentMazare (candle author, Kyutai). https://lib.rs/crates/pocket-tts
- **Phonemizer**: none (tokenizer-based; no espeak-ng dependency mentioned anywhere in docs).
- **Voices/control**: pre-made voices + **voice cloning from a plain WAV**; native chunked
  streaming.
- **Maintenance**: very active — v2.1.0 May 2026, 8 releases in 5 months.

### Supertonic (Supertone) — Sep 2025, major updates through May 2026

- **Quality**: strong for its size class; company-reported RTF up to 167× real-time on M4 Pro,
  0.3× RTF measured on an e-reader device. No arena placement found. 44.1 kHz output.
  https://github.com/supertone-inc/supertonic
- **Languages**: **31** (Supertonic 2), incl. Arabic, English, French, German, Japanese,
  Korean, Spanish; plus a language-agnostic `lang="na"` mode.
- **Size / hardware**: ~66M params (Supertonic 2; ~99M across public ONNX assets); trivially
  real-time on any laptop CPU; ONNX Runtime native.
- **License**: sample code MIT; **model weights OpenRAIL-M** — commercial use allowed but with
  behavioral use restrictions that must be passed downstream. Redistribution is permitted
  subject to those restrictions; fine to download-at-runtime like the existing STT catalog,
  worth a license notice in the catalog UI.
  https://github.com/supertone-inc/supertonic/blob/main/LICENSE ,
  https://huggingface.co/Supertone/supertonic
- **Rust integration**: **official Rust implementation in-repo** (alongside C++, Go, C#,
  Swift, Flutter, WebGPU...); also supported by sherpa-onnx (SupertonicTTS family).
- **Phonemizer**: no espeak-ng; per-language text processing ships with the repo (grapheme/
  tokenizer-based).
- **Voices/control**: 10 preset styles (M1–M5, F1–F5) + custom voices via their Voice Builder;
  speed control.
- **Maintenance**: very active (May 2026 updates, 13.3k stars).

### KittenTTS (KittenML) — official release Feb 2026

- **Quality**: usable but clearly below Kokoro; its pitch is size (15M params / ~25 MB).
- **Languages**: English only (multilingual on roadmap). https://github.com/KittenML/KittenTTS
- **Size / hardware**: nano/micro/mini 15/40/80M, int8 ONNX, runs on anything.
- **License**: Apache-2.0.
- **Rust integration**: sherpa-onnx support (https://github.com/k2-fsa/sherpa-onnx/pull/2460);
  multiple Rust ports (`kittentts` crate, eugenehp/kittentts-rs, second-state/kitten_tts_rs —
  the latter uses a pure-Rust espeak-ng reimplementation).
- **Phonemizer**: espeak-ng via `phonemizer` (GPL implications apply); sherpa packages bundle
  espeak-ng-data.
- **Voices/control**: 8 voices, speed parameter.
- **Maintenance**: developer preview v0.8.1 (Feb 2026); young project.

### Piper (rhasspy → Open Home Foundation)

- **Status change (important)**: `rhasspy/piper` (MIT) was **archived read-only in Oct 2025**;
  active development moved to **OHF-Voice/piper1-gpl** which is **GPL-3.0** (latest v1.4.2,
  Apr 2026). OHF has publicly asked for maintainers — a project-health yellow flag.
  https://github.com/rhasspy/piper , https://github.com/OHF-Voice/piper1-gpl
- **Quality**: dated (VITS-era); noticeably below Kokoro. Its strengths are speed and breadth:
  100+ voices, 30+ languages at 15–60 MB per voice, real-time on a Raspberry Pi.
  https://huggingface.co/rhasspy/piper-voices , https://rhasspy.github.io/piper-samples/
- **License**: new code GPL-3.0; old MIT code frozen; voices carry per-voice dataset licenses
  (check each — some are non-commercial datasets).
- **Rust integration**: sherpa-onnx runs Piper voices (vits-piper-* packages); `piper-rs`
  crate (thewh1teagle, MIT, wraps ONNX + espeak-rs). https://github.com/thewh1teagle/piper-rs
- **Phonemizer**: espeak-ng required (GPL).
- **Verdict**: viable as a legacy/low-end option via sherpa-onnx, but Kokoro/Supertonic beat
  it on quality at similar cost; the GPL move and maintainer vacancy argue against building on
  it.

### Chatterbox / Chatterbox Multilingual / Turbo (Resemble AI)

- **Quality**: top tier among open weights. Resemble's own blind study: 65.3% preferred
  Chatterbox Turbo over ElevenLabs (vendor claim, not independent).
  https://www.resemble.ai/learn/models/chatterbox
- **Languages**: Multilingual V3 covers 23+ (ar, da, de, el, en, es, fi, fr, he, hi, it, ja,
  ko, ms, nl, no, pl, pt, ru, sv, sw, tr, zh); Turbo (350M) is English-only; single-language
  500M finetunes exist. https://github.com/resemble-ai/chatterbox
- **Size / hardware**: 0.5B (350M Turbo). GPU strongly preferred; CPU generation is well below
  real time on typical laptops (community servers document CPU as "slow but possible" —
  exact CPU RTF unverified).
- **License**: **MIT** (all variants). Output carries Resemble's Perth neural watermark
  (imperceptible; note in docs if used).
- **Rust integration**: weak — PyTorch/Python; no ONNX or sherpa-onnx path found; no
  maintained candle port found (searched). Would require a Python subprocess or new port —
  high cost for this codebase.
- **Maintenance**: active through 2025–2026 (Multilingual Sep 2025, Turbo/V3 after; the
  GitHub releases page failed to load fully during research — exact V3 release date
  unverified).

### Qwen3-TTS (Alibaba Qwen) — new, Jan 2026

- **Quality**: near-frontier; vendor-reported SOTA-competitive across 10 languages (not yet
  independently arena-ranked as open weights as of this research).
- **Languages**: 10 — zh, en, ja, ko, de, fr, ru, pt, es, it. Voice cloning from ~3 s audio;
  VoiceDesign variant builds voices from natural-language descriptions.
  https://github.com/QwenLM/Qwen3-TTS
- **Size / hardware**: 0.6B and 1.7B (12 Hz codec-LM architecture); streaming generation
  supported. GPU realistic; 0.6B may be borderline on strong CPUs (unverified).
- **License**: Apache-2.0 (weights + code).
- **Rust integration**: none today (transformers/vLLM-style stack); GGUF/llama.cpp support
  not found (unverified/absent as of research date). Future candidate for a premium tier.
- **Maintenance**: released 2026-01-22; very active.

### Fish Speech / OpenAudio (Fish Audio)

- **Quality**: the historical open-weights arena leader (Fish Speech v1.5 Elo ~1339 on the
  old TTS-Arena; S2 Pro is the top open-weights entry on Artificial Analysis, reported Elo
  ~1117 — secondary source). https://huggingface.co/fishaudio
- **Licensing — blocker**: S1-mini weights are **CC-BY-NC-SA-4.0, gated, non-commercial**
  (https://huggingface.co/fishaudio/openaudio-s1-mini). S2-Pro (open-sourced Mar 2026) is
  under the **Fish Audio Research License — non-commercial**
  (https://huggingface.co/fishaudio/s2-pro , https://fish.audio/blog/fish-audio-open-sources-s2/).
  Also 4B+400M dual-AR — GPU-class. **Excluded** for an MIT plugin.

### XTTS-v2 (Coqui) — excluded

- 17 languages, voice cloning, still hugely downloaded, but weights are under the **Coqui
  Public Model License (CPML) — non-commercial**; Coqui the company shut down (code lives on
  in the idiap `coqui-tts` fork). **Unusable** for redistribution in this plugin.
  https://huggingface.co/coqui/XTTS-v2

### F5-TTS — excluded for shipping

- Code MIT, but official weights **CC-BY-NC-4.0** (Emilia dataset); maintainers confirm
  non-commercial. Quality is strong (flow-matching, zero-shot cloning) but you'd have to
  retrain to ship. https://github.com/SWivid/F5-TTS ,
  https://github.com/SWivid/F5-TTS/discussions/129

### MeloTTS (MyShell)

- MIT, multilingual (EN variants, es, fr, zh, ja, ko), real-time on CPU; sherpa-onnx ships a
  `vits-melo-tts-zh_en` conversion. Quality is Piper-class, and upstream activity has been
  minimal since 2024 (exact last-commit date unverified). A fallback option only.
  https://github.com/myshell-ai/MeloTTS

### Orpheus (Canopy Labs)

- Llama-3B-backbone speech LLM (also 1B/400M/150M), Apache-2.0, emotional/expressive tags;
  English-first with multilingual research releases. GGUF/llama.cpp community paths exist
  (attractive given this repo's ggml experience) but the SNAC audio decoder still needs a
  separate runtime; realistically GPU-tier for real-time. Best treated as a future premium
  option, not MVP. https://github.com/canopyai/Orpheus-TTS

### Dia (Nari Labs)

- 1.6B, Apache-2.0, English-only, dialogue-oriented (multi-speaker, non-verbal tags
  (laughs) etc.), GPU-oriented. Wrong shape for "read my note aloud" — expressive dialogue
  generator, not a document reader. Excluded. https://github.com/nari-labs/dia (verified via
  search results; repo not fetched directly)

### Zonos (Zyphra)

- Zonos-v0.1: 1.6B transformer + SSM-hybrid, Apache-2.0, expressive cloning, but: espeak-ng
  dependency (GPL), 1.6B = GPU-tier, and Zyphra's follow-up "Zonos2" appears to be a
  commercial/API offering (open-weights status not found — unverified). Momentum has moved
  elsewhere. https://github.com/Zyphra/Zonos , https://www.zyphra.com/our-work/zonos2

### Parler-TTS (Hugging Face)

- Apache-2.0, description-controlled voices; effectively dormant (no significant releases
  since 2024 — status inferred from release history; exact last activity unverified). Note:
  one search summary misattributed Parler to Nari Labs; it is a Hugging Face project
  (https://github.com/huggingface/parler-tts). Excluded on maintenance grounds.

### NeuTTS Air (Neuphonic) — Oct 2025

- 748M speech LM ("0.5B backbone" per model card), **GGML format**, Apache-2.0, instant voice
  cloning, on-device focus (Raspberry-Pi-capable per vendor). English-focused (full language
  list unverified). Interesting because GGML aligns with this repo's whisper.cpp stack, but
  single-language and heavier than the ONNX small tier.
  https://huggingface.co/neuphonic/neutts-air , https://github.com/neuphonic/neutts
- Note: repo moved/renamed (`neuphonic/neutts` now hosts it; `neutts-air` README lives on HF).

### VibeVoice (Microsoft)

- MIT, 1.5B (and larger), long-form multi-speaker (up to 90 min). Microsoft **pulled/limited
  the original repo shortly after the Aug 2025 release over misuse concerns**; current
  official availability is murky (community mirrors persist) — could not fully verify current
  repo state. Not a foundation to build on. https://github.com/microsoft/VibeVoice

### Others noted, not pursued

- **ZipVoice** (k2-fsa's own flow-matching zero-shot TTS) — supported natively in sherpa-onnx;
  worth a look if voice cloning inside sherpa-onnx becomes a requirement.
- **Matcha-TTS** — supported in sherpa-onnx; academic, small, en/zh only, superseded in
  practice by Kokoro.
- **MMS-TTS** (Meta) — 1000+ languages in sherpa-onnx, CC-BY-NC — excluded (license).
- **Fable/other closed 2026 arena leaders** (Qwen-Audio-3.0-TTS-Plus, Gemini Flash TTS,
  etc.) — closed/API-only, out of scope.

---

## Quality benchmarks: current state (mid-2026)

Per the Artificial Analysis Speech Arena (https://artificialanalysis.ai/text-to-speech/arena)
as summarized mid-2026: the entire top 10 is closed/API models; ~14 of 88 entries are open
weights; the best open-weights entry is Fish S2 Pro (~Elo 1117, non-commercial license), with
Kokoro-82M around rank 32 (~Elo 1056) on a very large sample. Exact Elo figures were taken
from a leaderboard summary (https://offlinetts.com/blog/tts-arena-leaderboard-2026/) — a
secondary source; treat numbers as indicative and re-check the live leaderboard before citing
externally. The original HF TTS-Arena is legacy
(https://huggingface.co/spaces/TTS-AGI/TTS-Arena); its successor is TTS Arena V2
(https://tts-agi-tts-arena-v2.hf.space/leaderboard).

Practical read: nothing local will match ElevenLabs-class API voices, but Kokoro-class is
comfortably "pleasant to listen to for a whole note," and Chatterbox/Qwen3-class narrows the
gap further at GPU cost.

---

## Licensing and the espeak-ng problem

**espeak-ng is GPLv3+** (https://github.com/espeak-ng/espeak-ng). Phoneme-based models
(Piper, Kokoro non-English/fallback, KittenTTS, Zonos) depend on it for G2P. Consequences for
this MIT repo:

- **Linking**: statically or dynamically linking espeak-ng into the sidecar makes the
  combined binary a GPL derivative — the sidecar's source would have to be offered under
  GPL-compatible terms. sherpa-onnx (itself Apache-2.0) compiles espeak-ng (via its
  piper-phonemize lineage) into builds that support Piper/Kokoro/Kitten voices, and its
  packages for those models bundle `espeak-ng-data`. So a sherpa-onnx-based sidecar that
  includes those model families inherits GPL obligations for the distributed binary.
  (Observed from sherpa-onnx packaging and source layout; exact build-flag granularity —
  whether espeak can be compiled out while keeping other TTS families — not verified.
  Verify `SHERPA_ONNX_ENABLE_TTS`-adjacent CMake options before committing.)
- Since the sidecar's source is already public in this repo, GPL compliance is *achievable*
  (publish the sidecar under GPL-3.0 while the plugin stays MIT — process separation between
  plugin and sidecar is mere aggregation), but it forks the repo's licensing story and
  constrains future proprietary embedding. Decide deliberately, not by accident.
- **Escape hatches**:
  - **Choose espeak-free models**: Supertonic, Pocket TTS, Chatterbox, Qwen3-TTS, NeuTTS
    need no phonemizer. An espeak-free catalog is the cleanest MIT path.
  - **Kokoro English-only via misaki**: misaki (Apache-2.0) covers EN/JA/KO/ZH/VI natively;
    espeak is only a fallback for OOD words and the remaining languages
    (https://github.com/hexgrad/misaki, https://github.com/hexgrad/kokoro/issues/247).
    A Rust `misaki-rs` crate exists but is unvetted (https://crates.io/crates/misaki-rs).
  - **Pure-Rust espeak reimplementations** used by some Kitten ports
    (second-state/kitten_tts_rs) — but a reimplementation of GPL espeak-ng's data/rules
    likely carries the same license; do not assume it launders the GPL. Unverified.
  - **Separate GPL helper process**: ship phonemization as its own GPL-licensed helper binary
    invoked over IPC; keeps the main sidecar MIT. More moving parts.

**License quick table**

| Model | Code | Weights | MIT-plugin compatible? |
|---|---|---|---|
| Kokoro-82M | Apache-2.0 | Apache-2.0 | Yes (espeak caveat for non-EN) |
| Pocket TTS | MIT | CC-BY-4.0 (gated HF) | Yes, attribution required |
| Supertonic | MIT | OpenRAIL-M | Yes-with-conditions (use restrictions propagate) |
| KittenTTS | Apache-2.0 | Apache-2.0 | Yes (espeak caveat) |
| Piper (current) | GPL-3.0 | per-voice | Only with GPL sidecar or old MIT snapshot |
| Chatterbox (all) | MIT | MIT | Yes (watermarked output) |
| Qwen3-TTS | Apache-2.0 | Apache-2.0 | Yes |
| MeloTTS | MIT | MIT | Yes |
| Orpheus | Apache-2.0 | Apache-2.0 | Yes |
| Dia | Apache-2.0 | Apache-2.0 | Yes |
| Zonos v0.1 | Apache-2.0 | Apache-2.0 | Yes (espeak caveat) |
| NeuTTS Air | Apache-2.0 | Apache-2.0 | Yes |
| F5-TTS | MIT | **CC-BY-NC-4.0** | **No** |
| XTTS-v2 | MPL (fork) | **CPML non-commercial** | **No** |
| OpenAudio S1-mini / S2-Pro | — | **CC-BY-NC-SA / research NC** | **No** |
| MMS-TTS | — | **CC-BY-NC** | **No** |

---

## Runtime integration for the Rust sidecar

- **sherpa-onnx (k2-fsa, Apache-2.0)** — recommended backbone.
  - Model families: VITS/Piper, Matcha, Kokoro, KittenTTS, ZipVoice, PocketTTS,
    SupertonicTTS, MMS. https://k2-fsa.github.io/sherpa/onnx/tts/index.html and
    https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html
  - Official Rust API in-tree plus community crates: `sherpa-rs` (thewh1teagle,
    https://github.com/thewh1teagle/sherpa-rs — `tts` feature flag, prebuilt-lib option,
    CUDA/DirectML features) and a `sherpa-onnx` crate wrapping the C API
    (https://docs.rs/sherpa-onnx).
  - **Chunked synthesis**: `GenerateWithCallback` delivers audio chunks during generation
    (see `sherpa-onnx-offline-tts-play.cc` in-repo), enabling play-while-generating for long
    notes without waiting for the whole document.
    https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/sherpa-onnx-offline-tts-play.cc
  - k2-fsa re-hosts converted, ready-to-download model archives — slots directly into the
    existing model-catalog/download UX.
- **ort (pykeio/ort)** — general ONNX Runtime binding if a model isn't in sherpa-onnx; you
  then own text normalization, G2P, and chunking yourself. Higher effort; only needed if
  bypassing sherpa.
- **candle** — `pocket-tts` crate is a native Rust/candle implementation (CPU, WASM)
  (https://lib.rs/crates/pocket-tts); candle has assorted TTS examples (Parler, MetaVoice)
  but nothing on the shortlist besides Pocket.
- **piper-rs** (https://github.com/thewh1teagle/piper-rs) — MIT crate for Piper-format ONNX
  voices with espeak-rs; only relevant if Piper voices are wanted despite the caveats.
- **ggml route** — NeuTTS Air ships GGML; Orpheus has llama.cpp paths + SNAC decoder. Aligns
  with the repo's whisper.cpp experience but each is a bespoke integration for a
  single-language model; not justified for MVP.
- **Long-document strategy**: none of the small models "stream" internally except Pocket TTS;
  sherpa-onnx's callback effectively chunks per generated segment. Regardless of engine, the
  feature should sentence/paragraph-split notes (markdown-aware: strip code blocks,
  frontmatter, links) and synthesize incrementally with a playback queue — same pattern the
  Chatterbox/Kitten community "audiobook servers" use.

---

## What comparable apps do

- **Handy** (cjpais/Handy, the system-wide reference app): STT-only; no TTS feature or plans
  in its README as of 2026-07-18. Its author's `transcribe-rs` spawned a community
  `tts-rs` doing Kokoro on Rust+ONNX — evidence the Rust/ONNX/Kokoro path is well-trodden.
  https://github.com/cjpais/Handy , https://github.com/rishiskhare/tts-rs
- **Obsidian ecosystem** (verified via community plugin listings): no plugin ships a local
  neural TTS model today.
  - *Text to Speech* (joethei) — OS/browser Web Speech API voices.
    https://github.com/joethei/obsidian-tts
  - *Note Reader* — Web Speech API "local mode" with word highlighting.
    https://community.obsidian.md/plugins/note-reader
  - *Aloud* — cloud (OpenAI et al., API key). https://github.com/adrianlyjak/obsidian-aloud-tts
  - *Voice* — cloud engines (Polly, ElevenLabs, OpenAI, Google, Azure).
    https://community.obsidian.md/plugins/voice
  - Implication: a genuinely local, high-quality, multilingual "read note aloud" is an
    unoccupied niche that matches this plugin's local-first positioning exactly.

---

## Open questions / not verified

- sherpa-onnx build-flag granularity for excluding espeak-ng while keeping espeak-free TTS
  families (needs a build experiment).
- `misaki-rs` and pure-Rust espeak reimplementation maturity and license cleanliness.
- Exact CPU real-time factors for Kokoro/Supertonic/Pocket on the project's baseline hardware
  (older x86 laptops) — vendor numbers are Apple-silicon-heavy; benchmark before choosing the
  default model.
- Chatterbox V3/Turbo exact release dates (GitHub releases page failed to load fully).
- Zonos2 open-weights status; VibeVoice current official repo state.
- Whether Qwen3-TTS has viable GGUF/llama.cpp inference (none found as of research date).
- Pocket TTS `pocket-tts-without-voice-cloning` repo purpose/gating; per-language voice-clone
  availability.
