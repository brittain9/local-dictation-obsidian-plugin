# Nemotron 3.5 ASR Stage A artifact record

This document records gate A0 for the Stage A implementation defined by
[PR #273](https://github.com/brittain9/local-dictation-obsidian-plugin/pull/273).
Stage A keeps the product English-only, fixes the encoder prompt to `en-US`,
and leaves Moonshine as the recommended live-dictation default. The installed
application runs the selected export through its existing native ONNX Runtime;
it does not install or invoke Python, PyTorch, NeMo, or sherpa-onnx.

## Pinned model lineage

The selected model is pinned at every published boundary:

| Input | Revision | SHA-256 / role |
| --- | --- | --- |
| [NVIDIA checkpoint](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/tree/f3d333391852ba876df169dcc9ba902d25b6ab0b) | `f3d333391852ba876df169dcc9ba902d25b6ab0b` | `.nemo`: `210214ed94039bf6bfbb9a047c7fa289628db75b103e2bf6381fa78285436a74` (2,368,284,501 bytes) |
| [NeMo parity implementation](https://github.com/NVIDIA/NeMo/tree/06312c963ce69c308d67ec7f129800ba594d9565) | `06312c963ce69c308d67ec7f129800ba594d9565` | Reference frontend and cache-aware streaming inference |
| [sherpa-onnx exporter](https://github.com/k2-fsa/sherpa-onnx/tree/f71d85ff2f07422014f55fa89cb083fa52cce71f/scripts/nemo/nemotron-3.5-asr-streaming-0.6b) | `f71d85ff2f07422014f55fa89cb083fa52cce71f` (merged as `6a204636c4b8d97b45e8c4ab4a22e0067162b637`) | Exact source used by the [successful public export run](https://github.com/csukuangfj/sherpa-onnx/actions/runs/28933312668) |
| [Published 560 ms int8 package](https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11/tree/ab43d895f5985b1bbab8b6eac8607fcdc05343f3) | `ab43d895f5985b1bbab8b6eac8607fcdc05343f3` | Exact catalog source |

The four required runtime artifacts total 682,215,356 bytes (about 651 MiB):

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `encoder.int8.onnx` | 657,601,403 | `012e9321373af99021415e0b0eb3ec827b4be3153be6f30d9b448fe65e896e68` |
| `decoder.int8.onnx` | 14,978,075 | `19f9c98fc6d0a2c33a65a43b36fdb2e914c26c0aa9764be3aebc502a1e982fb0` |
| `joiner.int8.onnx` | 9,504,438 | `4101c7c679a0bc30483794b27a059e34e79232aa2068d78d51231a22c8b0d7ce` |
| `tokens.txt` | 131,440 | `729cc103155bafa785f9cd45746cd41cabe97eab7182fc04d594129587958f8a` |

The ONNX hashes and sizes were verified against the downloaded files. Hugging
Face exposes LFS SHA-256 metadata for the three graphs; `tokens.txt` is a normal
Git blob, so its SHA-256 was computed from the bytes at the pinned revision.

## Export choice

The int8 sherpa-onnx package is the Stage A artifact. It is the only evaluated
export that supplies the required encoder/decoder/joiner plus `tokens.txt`
contract at 560 ms. Its metadata identifies the cache-aware multilingual graph,
and the upstream workflow exercises the package with sherpa-onnx after export.

The comparison candidate was
[`onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4`](https://huggingface.co/onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4/tree/8364d9e2dd9da23789b480bdbba9e423717e42ee)
at revision `8364d9e2dd9da23789b480bdbba9e423717e42ee`. It was not selected:

- it targets ONNX Runtime GenAI and splits the encoder, decoder, and joint
  weights into external `.onnx.data` files instead of the sherpa transducer
  package consumed by Stage A;
- it ships `tokenizer.json`/`vocab.txt`, not the required `tokens.txt`;
- its six graph files total 790,390,236 bytes before tokenizer/config files,
  108,174,880 bytes larger than the selected int8 runtime set; and
- its model card does not publish an English accuracy result for the quantized
  ONNX. The 7.91 English FLEURS WER in the card metadata is the base model's
  1.12-second result, so it is not evidence of int4 quality at 560 ms.

Using the int4 package would therefore widen the runtime and tokenizer scope
without a demonstrated size or English-quality benefit.

## Pinned-bytes guarantee

The published export recipe is not bit-reproducible as written. The public run
resolved NeMo `main` to `06312c963ce69c308d67ec7f129800ba594d9565`, but
the workflow itself names moving branches and dynamically resolves Python and
ONNX Runtime dependencies. The exporter also loads the NVIDIA model without an
explicit revision.

This integration makes the narrower guarantee it can prove: the source
checkpoint, reference implementations, successful export run, published output
revision, artifact sizes, and every installed byte are recorded and pinned.
Regenerating byte-identical ONNX files would require a separately locked export
environment and is not claimed here.

## Runtime graph contract

The pinned encoder declares these ordered inputs:

1. `audio_signal`: `f32 [B, 128, T]`
2. `length`: `i64 [B]`
3. `cache_last_channel`: `f32 [B, 24, 56, 1024]`
4. `cache_last_time`: `f32 [B, 24, 1024, 8]`
5. `cache_last_channel_len`: `i64 [B]`
6. `prompt_index`: `i64 [B]`

It returns `outputs`, `encoded_lengths`, `cache_last_channel_next`,
`cache_last_time_next`, and `cache_last_channel_next_len` in that order. Stage A
always sends prompt index `0`, which the graph's pinned `prompt_dictionary`
maps to `en-US`; auto-detect index `101` is intentionally unused.

Required encoder metadata includes `chunk_size_ms=560`, `window_size=65`,
`chunk_shift=56`, `subsampling_factor=8`, `feat_dim=128`,
`cache_last_channel_dim1/2/3=24/56/1024`,
`cache_last_time_dim1/2/3=24/1024/8`, `pred_rnn_layers=2`,
`pred_hidden=640`, and `vocab_size=13087`. The tokenizer contains 13,088
contiguous entries and ends with blank token `<blk>` at id 13,087. The decoder
accepts the token/length pair and two `f32 [2, B, 640]` predictor states; the
joiner returns 13,088 logits.

The feature frontend is 16 kHz mono, 128-bin log-mel, 25 ms symmetric Hann
windows, 10 ms stride, 512-point FFT, global preemphasis 0.97, centered
zero-padded framing, additive `2^-24` log guarding, and no normalization.
Random dither is disabled for deterministic inference. These details match the
pinned NVIDIA NeMo frontend and are enforced by the committed numeric oracle.

## NeMo golden parity

The committed fixture
[`native/tests/fixtures/nemotron/golden-560ms.json`](../../native/tests/fixtures/nemotron/golden-560ms.json)
uses LibriSpeech utterance `7021-79740-0000` (178,000 samples at 16 kHz). It
records selected values across the 128-by-1,112 NeMo feature matrix, a digest of
the full matrix quantized to `1e-5`, the final RNNT token ids, and decoded text.
[`reference-560ms.jsonl`](../../native/tests/fixtures/nemotron/reference-560ms.jsonl)
is the manifest used by NVIDIA's reference script.

The oracle was generated with checkpoint revision `f3d333391852ba876df169dcc9ba902d25b6ab0b`,
NeMo revision `06312c963ce69c308d67ec7f129800ba594d9565`, PyTorch
2.12.1, attention context `[56, 6]`, CPU float32, and forced `en-US`. The
frontend oracle explicitly disables dither because a random golden cannot be
reproduced by the deterministic installed runtime. The unmodified NeMo
streaming script was also run separately and produced the same final text:

> To such persons, these indirect modes of training children inhabits of
> subordination to their will, or rather of yielding to their influence are
> specially useful

The fixture preserves the model's `inhabits` error instead of correcting the
oracle to the LibriSpeech reference.

## Local acceptance and performance

The pinned int8 export was exercised on an Apple M2 Pro with 16 GiB RAM, CPU
only, using a release build. The full VAD/worker/revision test includes model
load, LibriSpeech `7021-79740-0000`, and the harness's trailing-silence path.
Running the release test executable directly under `/usr/bin/time -l` recorded:

- 13.50 seconds process wall time (12.81 seconds inside the test);
- 1,354,842,112 bytes maximum resident set size (1.355 GB); and
- 0.115 WER on the VAD-trimmed worker transcript, with all required anchors.

PR #258 recorded 15.24 seconds and 1.557 GB for the equivalent Parakeet worker
path. On this comparison, Nemotron Stage A reduces wall time by about 11% and
peak RSS by about 13%. A separate direct load-plus-one-shot run, excluding the
real-time worker cadence, completed inference in 1.893 seconds with 0.000 WER.

## License

The checkpoint and derived weights are licensed under
[OpenMDW-1.1](https://openmdw.ai/license/1-1/), not this project's MIT license.
The release-bundled `THIRD_PARTY_NOTICES.md` contains the full agreement,
checkpoint/export attribution, and the derived-weight modification notice.
