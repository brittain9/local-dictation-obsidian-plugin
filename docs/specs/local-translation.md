# First-class local text translation

## Decision

Local Dictation will add explicit, preview-first text translation as the third
local language workflow alongside speech to text and text to speech:

speech → transcription → optional cleanup → optional translation → optional
read aloud.

Translation uses one selected catalog model. When no translation model is
selected, the first model the user installs becomes active; switching between
installed models remains explicit. Firefox Translations models run in an
isolated Obsidian Web Worker; Tencent HY-MT 2 1.8B and 7B
Q4_K_M models run in a version-matched helper supervised by the native sidecar
over framed standard input/output. The 1.8B model uses less storage and memory;
the 7B model is a presentation-only Heavy option with a 4.62 GB download.

This decision supersedes the original TranslateGemma recommendation after a
local feasibility spike on 2026-07-27. The owner explicitly rejected its
measured latency as too slow to ship.

### HY-MT 2 terms and notice

HY-MT 2 is an optional, direct user-initiated upstream download. Model bytes are
not included in the plugin release archives. The catalog links to Tencent's
pinned Apache-2.0 license and records the required attribution. The model
remains a direct upstream download; Speech Kit does not redistribute its bytes.

Model badges describe resource cost only. Preview remains mandatory before any
note mutation.

## Runtime choices

The product supports two independently selectable runtime families:

- Firefox/Bergamot for its compact, exact-direction translation packs.
- Tencent HY-MT 2 for its broader all-to-all language coverage.

The catalog is the source of truth. Users can select a different installed
model through Manage Models or the translation preview; neither runtime is
preferred, prioritized, or used as a silent fallback for the other.

Measured on an M2 Pro:

| Runtime/model | Cold/runtime load | Warm translation | Long input | Peak footprint | Download |
| --- | ---: | ---: | ---: | ---: | ---: |
| TranslateGemma 4B q4 ONNX, CPU | 3.6–3.9 s model load; ~1.5 s first token | ~3.29 output tokens/s | minutes for long notes | 3.1–3.4 GB RSS | ~3 GB |
| TranslateGemma 4B Q4_K_M GGUF, Metal | ~10 s cold load | ~60 output tokens/s | viable after load | ~3 GB memory footprint | 2.49 GB |
| Firefox/Bergamot, CPU WebAssembly | 12 ms runtime; 22–54 ms model load | ~17 ms short warm request | 10,900 chars in 2.33 s | ~418 MB RSS | ~552 MB for all 14 directions |

The final production-worker smoke test loaded the runtime in 37 ms and
translated two English→Spanish sentences in 235 ms total. A beam size of four
was also tested; it was slower and did not improve the observed wording, so v1
uses Firefox's fast beam-size-one configuration.

The benchmark above is historical context for why both runtime families are
kept small and locally runnable. It does not define a quality tier, default,
recommendation, or routing rule.

## License and provenance

The models, vocabularies, lexicons, JavaScript glue, and Bergamot WebAssembly
runtime are MPL-2.0. The catalog records that license before installation and
pins every downloaded file by URL, byte size, and SHA-256.

- Model dashboard: <https://mozilla.github.io/translations/firefox-models/>
- Model repository: <https://github.com/mozilla/firefox-translations-models>
- Current training/runtime repository: <https://github.com/mozilla/translations>
- Bergamot integration documentation:
  <https://firefox-source-docs.mozilla.org/toolkit/components/translations/resources/03_bergamot.html>
- JavaScript glue pinned from Firefox revision
  `0e9cfbb4fca901314b1b18f871ae23d5adb16c0f`
- WebAssembly runtime revision reports
  `v0.6.0+1de4a085d3a7afb625c51a60aabb5ad298e4059f`

`THIRD_PARTY_NOTICES.md` records the downloaded components and MPL-2.0
obligations. No Gemma terms apply to v1.

## Scope

### V1

- `Translate selection` editor command.
- `Translate note` editor command.
- Selection context-menu entry.
- Explicit source and target languages with a swap action.
- Preview before any note mutation.
- Replace, insert below, and copy actions.
- Cancel by terminating the worker; cancellation never changes the note.
- Managed installation and removal through the existing Manage Models UI.
- Offline inference with no cloud translation provider or silent fallback.
- The selected catalog model determines supported language pairs. Firefox
  models cover their exact English-anchored directions; either HY-MT 2 model
  covers all directed, non-identity pairs among its 38 documented languages.

### Not v1

- Automatic source-language detection.
- Automatic source-language detection or pivoting through another language.
- Automatic translation after dictation or cleanup.
- Whole-vault or multi-note translation.
- A glossary or custom do-not-translate list.
- A ribbon icon.
- `Translate last utterance`.
- Model ranking, priority, fallback, or engine routing. First-install
  activation only fills an otherwise empty task slot.

## User workflow

1. The Models settings group shows the selected translation model and links to
   Manage Models. The Translation settings group sets the source and target
   language preferences.
2. The user selects text or invokes translation for a non-empty active note.
3. A modal opens with the active source and target languages in both its title
   and controls.
4. If the translation pack is missing, the modal links directly to Manage
   Models filtered to Translation.
5. The modal can switch among installed translation models and language pairs;
   changing either marks the preview stale and never starts inference by itself.
6. The selected model adapter reads only its exact installed artifacts and runs
   locally without network access.
7. The user reviews the complete result.
8. Replace and Insert below are enabled only if the original source range is
   unchanged and every Markdown unit rebuilt safely. Copy remains available
   when the note changed or a partial preview is retained for inspection.

The source and target preferences persist tolerantly. If no preference exists,
source defaults to the explicit dictation language when supported, otherwise
English; the target defaults to English or Spanish as needed to form a supported
pair. Invoking Translate note on an empty
note explains that there is no text to translate instead of silently doing
nothing.

## Markdown preservation

TypeScript splits input into protected and translatable spans before inference
and rebuilds the result afterwards. Protected content is copied byte-for-byte:

- YAML frontmatter;
- fenced and inline code;
- block and inline math;
- URLs and Markdown link destinations;
- wikilinks and embeds;
- raw HTML tags;
- Obsidian tags and callout type markers;
- heading/list/blockquote/checkbox markers and table pipes;
- indentation, paragraph breaks, and trailing-newline state.

Markdown link labels and ordinary prose are translated. A failed, canceled, or
partial operation never writes to the editor. V1 caps one operation at 50,000
source characters and warns above 10,000.

Each ordinary Markdown line remains one contextual translation unit whenever
possible. Protected inline syntax is represented by unique private-use markers
during inference. Because the Japanese tokenizer drops private-use characters,
Japanese pairs instead use synthetic URL markers that those pair vocabularies
copy exactly. Markers are restored only when every marker returns exactly once
and in order. This lets the model translate the surrounding sentence as a whole
without exposing code, destinations, or Obsidian syntax. Missing, duplicated,
or reordered markers keep their source unit and disable note-writing actions;
the resulting partial preview remains copyable for inspection. Very long lines
split at sentence or whitespace boundaries into units of at most 2,000
characters.

Proper nouns and terminology rely on model behavior in v1. The real-model
smoke fixtures exposed occasional stylistic or terminology blemishes; the UI
therefore describes the result as a preview, not guaranteed publication-ready
copy. A user glossary is a later feature if real use demonstrates demand.

## Architecture

### Catalog and capability layer

The existing cross-language contracts gain:

- `ModelTask::Translation` / `"translation"`;
- `RuntimeId::BergamotWasm` / `"bergamot_wasm"`;
- `RuntimeId::LlamaCpp` / `"llama_cpp"`;
- `ModelFamilyId::FirefoxTranslations` / `"firefox_translations"`;
- `ModelFamilyId::TencentHyMt` / `"tencent_hy_mt"`;
- `ModelFormat::Bergamot` / `"bergamot"`;
- `ArtifactRole::TranslationModel` / `"translation_model"`;
- catalog `translationSupport`, either exact directed `pairs` or an
  `all_to_all` language set.

Catalog validation requires a translation primary artifact and valid,
non-identity support metadata whose languages also appear in `languageTags`.
Non-translation models may not declare translation support.

Firefox remains one managed pack for all fourteen directions. HY-MT is one
managed row and one pinned GGUF, not one row per language.

### Inference boundary

`TranslationController` owns editor snapshots, model resolution, settings, and
a detachable `TranslationJob`. Engine adapters keep modal job logic independent
from the inference implementation. `translateWithBergamot`:

1. resolves exact artifacts from catalog metadata and the verified install
   record;
2. reads the glue, WebAssembly, model, lexicon, and vocabulary files;
3. creates a Blob-backed classic Web Worker from the pinned MPL glue plus the
   separately bundled worker bootstrap;
4. transfers ArrayBuffers rather than cloning them;
5. batches all bounded contextual translation units into one Bergamot call;
6. terminates the worker on completion, error, or cancellation.

Per-operation loading is intentional. Measured model initialization is tens of
milliseconds, so caching a several-hundred-megabyte worker would add lifecycle
complexity without a meaningful UX win.

The HY-MT adapter sends ordered prose units through `start_translation` and
receives job-keyed progress and completion events. The main sidecar validates
the managed model path and launches an exact sibling helper. The helper uses a
pinned llama.cpp Rust binding, applies the GGUF chat template once, and enforces
Tencent's prompt and sampling profile. Keeping it outside the main executable
avoids Whisper/llama.cpp GGML symbol collisions. It exits on pipe or parent
shutdown and is released after five idle minutes.

## Quality policy

Mozilla's released-model dashboard is the source of upstream quality evidence;
its release acceptance target is within five percent of Google Translate by
COMET. Local round-trip smoke tests across all fourteen directions preserved
negation, dates, numbers, and most technical terms, with occasional stylistic
blemishes.

Those results justify shipping a useful preview workflow, not claiming parity
with every cloud translator or professional human translation. Product copy
must say:

- fast local/offline translation;
- exact supported directions;
- preview before editing.

It must not say:

- perfect translation;
- certified accuracy in every domain;
- cloud-frontier quality.

## Privacy and resource behavior

- Note text never leaves the device for translation.
- Network access is used only when the user explicitly installs the pack.
- No telemetry is added.
- Cancel terminates the active work immediately.
- Bergamot releases worker and model objects after each operation. HY-MT
  releases its helper and model after five idle minutes or on parent shutdown.
- Translation does not require an API key, Python, Ollama, CUDA, or the
  optional remote LLM feature.

## Verification gates

Required before merge:

- TypeScript typecheck.
- Biome and Obsidian lint.
- Full frontend test suite.
- Native catalog and registry tests.
- Production frontend bundle.
- Worker smoke with the exact pinned runtime and at least one exact pinned
  direction for each engine.
- Unit fixtures proving Markdown structure round-trips unchanged when output
  text is unchanged.
- Settings normalization tests.
- Command availability tests.
- Model install/remove and missing-model recovery review.
- Live Obsidian test-vault check on the built bundle, including translation
  model installation, selection/switching, close/reopen, cancel, and apply
  flows.

The real-model worker and Markdown smoke is deliberately excluded from default
CI, like the repository's ignored native-model suites. Run the HY-MT 2 smoke
after installing its managed pack:

```sh
npm run test:translation:hy-mt2:e2e
```

The script bundles the same segmentation code used by production, loads the
pinned HY-MT 2 installation, translates real Markdown, checks
English-to-Spanish meaning, and verifies that code, wikilinks, tags, math, link
destinations, and table structure survive byte-for-byte. The packaged helper
smoke must exercise the sidecar/helper boundary, not a localhost server or a
standalone llama.cpp executable.

Recommended follow-up evidence:

- real-model smoke for every direction on Windows, macOS, and Linux;
- bilingual review for each advertised direction;
- measure cold load, long-note latency, and peak memory on representative
  minimum hardware;
- split the pack into smaller per-language downloads only if install size is a
  demonstrated adoption problem;
- exercise both HY-MT 2 Q4_K_M records across CPU/GPU execution, cancellation,
  and cached-model switching on representative hardware.

## Rejected approaches

- **TranslateGemma ONNX default:** license was workable and quality promising,
  but measured CPU decode at roughly three tokens per second is not an
  interactive note workflow.
- **TranslateGemma GGUF default:** fast after load on Metal, but multi-gigabyte
  download/memory and roughly ten-second cold start are too heavy for the
  default.
- **Python backend:** Python cannot be assumed on every desktop, bundling it
  adds platform/security/release burden, and Bergamot already supplies the
  needed licensed CPU path.
- **Cloud translation:** contradicts the private/offline product promise.
- **Translation through Ollama/LLM cleanup:** external daemon, unmanaged model
  behavior, and no stable per-direction capability contract.
- **Whisper speech translation:** audio-only and English-target-only; it cannot
  translate existing note text.
- **Non-commercial small models:** incompatible with the intended product
  license and possible commercial distribution.
