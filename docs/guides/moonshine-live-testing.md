# Moonshine live dictation testing

Moonshine live dictation uses the official `tiny-streaming-en` ORT asset set.
The model is not installed by the plugin and model binaries must not be added to
this repository.

## Download the test model

Create a directory outside the repository and download the seven assets from
Moonshine AI's public model endpoint:

```sh
model_dir="$HOME/.local/share/local-dictation/moonshine/tiny-streaming-en"
base_url="https://download.moonshine.ai/model/tiny-streaming-en/quantized"
mkdir -p "$model_dir"

for file in \
  frontend.ort encoder.ort adapter.ort cross_kv.ort decoder_kv.ort \
  streaming_config.json tokenizer.bin
do
  curl --fail --location "$base_url/$file" --output "$model_dir/$file"
done
```

The directory layout is fixed:

```text
tiny-streaming-en/
├── frontend.ort
├── encoder.ort
├── adapter.ort
├── cross_kv.ort
├── decoder_kv.ort
├── streaming_config.json
└── tokenizer.bin
```

Select `frontend.ort` as an external ONNX model with the Moonshine family. The
adapter resolves the other six files from the same directory.

For a local adapter smoke test, pass that entry graph to the ignored real-model
test. This compiles the CPU Moonshine feature and decodes the repository WAV in
20 ms frames:

```sh
MOONSHINE_MODEL_PATH="$model_dir/frontend.ort" \
  cargo test --manifest-path native/Cargo.toml --features engine-moonshine \
  local_model_decodes_fixture_in_streaming_chunks -- --ignored --nocapture
```

This layout is the true streaming export used by the MIT-licensed
[Moonshine reference implementation](https://github.com/moonshine-ai/moonshine).
It keeps frontend state across chunks, incrementally encodes frames with bounded
lookahead, and caches decoder and cross-attention keys and values. It is not the
non-streaming `moonshine-tiny` ONNX export in `onnx-community`.

## Manual acceptance checks

In Obsidian, open the plugin settings, choose an external model, set its family
to **Moonshine**, and select `frontend.ort`. Use CPU inference with a 16 kHz
microphone, then verify:

- The first partial appears within one second of speech onset.
- Changed text refreshes at roughly 500 ms intervals.
- The final revision appears within 700 ms of VAD close.
- A five-minute continuous session has no audio drops or revision reordering.
- Typing inside provisional text latches the span and later model revisions do
  not overwrite the edit.
- Provisional text is readable in both light and dark themes and loses its
  styling when finalized.
- Finalized text uses the model's native sentence casing and punctuation.

CUDA uses the existing ONNX Runtime execution-provider path but is not an
acceptance gate for this change.
