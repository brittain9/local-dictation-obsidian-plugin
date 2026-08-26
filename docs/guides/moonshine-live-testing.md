# Moonshine live dictation testing

Moonshine live dictation uses the official quantized streaming ORT assets from
Moonshine AI. Model binaries must not be added to this repository.

## Install through Manage Models

In Obsidian, open **Speech Kit settings → Manage models → Moonshine**.
Choose Moonshine Tiny, Small, or Medium and select **Install**. Small is the
recommended starting point; Tiny favors low-end CPUs and Medium favors
accuracy. A first install is selected automatically. Otherwise, select **Use**
after installation.

Manage Models downloads all seven required files, verifies their pinned sizes
and SHA-256 checksums, validates the model, and only then promotes the complete
install into the model store. Use the same screen to select, update, or remove a
Moonshine model.

## Behavior and limitations

Moonshine writes provisional text while you speak, revises that text in place,
and locks the final text when voice activity detection closes the utterance.
Tiny is suitable for lower-end CPUs, Small is the recommended starting point,
and Medium requires more CPU time and memory in exchange for accuracy; actual
latency depends on the host processor.

Live dictation is English-only. Speaker labels are not applied while a
streaming model is selected, even when diarization is enabled. Continuous
speech is split into separate utterances at the 30-second hard cap.

## Manual acceptance checks

Use a Moonshine model installed through Manage Models with CPU inference and a
16 kHz microphone, then verify:

- The first partial appears within one second of speech onset.
- Changed text refreshes at roughly 500 ms intervals.
- The final revision appears within 700 ms of VAD close.
- A five-minute continuous session has no audio drops or revision reordering.
- Typing inside provisional text latches the span and later model revisions do
  not overwrite the edit.
- Provisional text is readable in both light and dark themes and loses its
  styling when finalized.
- Finalized text uses the model's native sentence casing and punctuation.

Moonshine runs on CPU in the current production sidecars. Any future accelerated
backend needs its own performance and correctness acceptance gates.

## Developer appendix: manual CDN assets

The external-file path remains useful for the ignored real-model adapter test.
Create a directory outside the repository and download the official
`tiny-streaming-en` asset set:

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

Select `frontend.ort` when using this directory as an external ONNX model. The
adapter resolves the other six files from the same directory. To run the
ignored real-model test against it:

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
