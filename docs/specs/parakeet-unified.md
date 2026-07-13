# NVIDIA Parakeet Unified integration

Local Dictation supports the 560 ms int8 buffered-streaming export of
`nvidia/parakeet-unified-en-0.6b` as an optional English live-dictation model.
The installed application runs the model entirely in the Rust sidecar through
the existing ONNX Runtime. It does not install or invoke Python, PyTorch, NeMo,
or sherpa-onnx.

Moonshine remains the default live-dictation family. Parakeet is a 632 MiB
download and recomputes 5.6 seconds of left context for every 160 ms center
chunk, so it trades substantially more CPU and memory for a different accuracy
profile.

## Pinned model lineage

The catalog is byte-pinned at every boundary:

| Input | Revision | SHA-256 / role |
| --- | --- | --- |
| [NVIDIA checkpoint](https://huggingface.co/nvidia/parakeet-unified-en-0.6b/tree/fe53cd885760c96b6a5f51a0bfd362cb4584a98b) | `fe53cd885760c96b6a5f51a0bfd362cb4584a98b` | `.nemo`: `ec23ed9150c8fde49072c3e2d61678ab903dbcef389d658db833420cbc1da35b` |
| [sherpa-onnx export implementation](https://github.com/k2-fsa/sherpa-onnx/tree/v1.13.2/scripts/nemo/parakeet-unified-en-0.6b) | v1.13.2 / `13d0ae6c539d2809d32f5eaa3ef1db0c459d0b24` | Reference exporter and parity oracle |
| [Published int8 ONNX export](https://huggingface.co/csukuangfj2/sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms/tree/7551fd26fc810cc1e4e043e608db4d13b59be31e) | `7551fd26fc810cc1e4e043e608db4d13b59be31e` | Exact catalog source |

The runtime artifacts are:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `encoder.int8.onnx` | 654,046,389 | `e566c3f014598a41724f2df028779a2d4cf7943cbefa324964f6a72e8ee255fb` |
| `decoder.int8.onnx` | 7,257,777 | `34fea72425d2506600772ba191a6d3f99c0710abdb68d9a3dc89fa8cb2aa473a` |
| `joiner.int8.onnx` | 1,735,860 | `869f43f7d24595c55581ad3bf249a935fb8a71389fbdaa7504b9f46f93140f8a` |
| `tokens.txt` | 8,952 | `dc0b4584ab2e4ddbf888425c076c61b736e7356a015250db7d307e6f1a8188ff` |

The installer also preserves NVIDIA's bias, explainability, privacy, and safety
documents beside the model. It verifies all eight downloads before atomically
committing the model directory.

The upstream export recipe downloads its NeMo and toolchain dependencies from
moving branches, so it is not a bit-reproducible build recipe as published.
This integration therefore makes the narrower claim it can prove: the source
checkpoint, export implementation, published output revision, sizes, and every
installed byte are pinned. Regenerating the ONNX files requires a separately
locked NeMo export environment and is not part of the installed application.

## Runtime contract

The `parakeet_unified` family adapter owns the graph convention and validates it
before selection:

- encoder: `f32 [B,128,T]` plus `i64 [B]`, producing `f32 [B,1024,Tenc]`;
- predictor: one `i32` token plus two `f32 [2,B,640]` LSTM states;
- joiner: one encoder frame plus one predictor output, producing 1,025 logits;
- token 1024 is the blank token and must be the last entry in `tokens.txt`;
- encoder metadata must declare `nemo_parakeet_unified_streaming`, per-feature
  normalization, positive bounded dimensions, and consistent x8 feature/encoder
  context sizes.

Audio becomes 128-bin log-mel features with the same NeMo/librosa parameters as
the sherpa-onnx v1.13.2 reference: 16 kHz normalized mono, 25 ms frames, 10 ms
stride, non-snipping reflected edges, periodic Hann, 512-point FFT, preemphasis
0.97, no dither, and no DC-offset removal.

At each decode step the adapter builds 560 left + 16 center + 40 right feature
frames, zero-pads unavailable context, and normalizes that complete 616-frame
window with population variance. The encoder is rerun for the window; only its
two center frames are passed to greedy RNNT decoding. Predictor state and tokens
are retained between chunks. Finalization flushes the short final center with
zero-padded right context; it does not replay audio already decoded.

## Verification

The normal Rust suite covers metadata bounds, tokenizer invariants, feature
framing/reflection, periodic Hann behavior, population normalization, padding,
registry wiring, and catalog validation. The ignored real-model suite verifies
partial prefix stability, final equivalence with a one-shot feed, corpus WER and
anchor words, and silence behavior:

```sh
STT_TEST_PARAKEET_DIR=/path/to/model-directory \
  cargo test --manifest-path native/Cargo.toml \
  --features engine-parakeet-unified \
  --test parakeet_e2e -- --ignored --nocapture
```

The four required inference files in that directory are `encoder.int8.onnx`,
`decoder.int8.onnx`, `joiner.int8.onnx`, and `tokens.txt`.

## License

The model and derived weights use the
[NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/),
not the project's MIT license. The release-bundled `THIRD_PARTY_NOTICES.md`
contains the agreement, required NVIDIA notice, checkpoint/export attribution,
and a prominent derived-weight modification notice. The catalog shows the same
license before download.
