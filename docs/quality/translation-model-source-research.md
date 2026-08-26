# Translation candidate source research

> Historical HY-MT 1.5 source research retained for provenance only. It does
> not describe the active production catalog, license flow, or model-routing
> behavior. Current production support uses pinned Apache-2.0 HY-MT 2 records.

Primary-source review for `tencent/HY-MT1.5-1.8B-GGUF` and
MADLAD-400-3B-MT Q4_K_M. Checked on 2026-07-27 without downloading model
weights in full; only anonymous one-byte range requests were made against the
three candidate artifacts. Repository state and runtime support can change;
immutable revisions are recorded below.

## Bottom line

Update 2026-08-21: the unrestricted global model entry rejected below was
superseded by the later HY-MT 2 integration. The current records use pinned
Apache-2.0 metadata and ordinary model-manager selection. This historical note
is not legal advice or a current product policy.

- **HY-MT1.5 is source-level viable with llama.cpp and Metal, but its license is
  not globally shippable.** Tencent publishes the GGUF itself, documents a
  `llama-cli` invocation, and current llama.cpp recognizes Hunyuan Dense. On
  macOS, current llama.cpp enables Metal by default. However, the Tencent HY
  Community License expressly excludes the EU, UK, and South Korea and forbids
  use, distribution, display, and use of outputs outside its defined Territory.
  A globally available Obsidian model option would therefore need separate
  licensing or reliable territorial exclusion. This is a product/legal blocker,
  independent of benchmark quality.
- **MADLAD is supported by current `llama-cli`, but not by upstream
  `llama-server`; exact Q4_K_M+Metal operation still needs a real smoke test.**
  llama.cpp added T5/Flan-T5 inference, including encoder-decoder handling in
  `llama-cli`, in commit
  [`807b0c4`](https://github.com/ggml-org/llama.cpp/commit/807b0c49ff7071094f97ebc3a0a8e2b9e274f503).
  As of inspected master commit
  [`91f8c9c`](https://github.com/ggml-org/llama.cpp/commit/91f8c9c5fb038c086e13e9cd823c29b33b07ba54),
  the architecture, conversion, and encoder/decoder graphs remain present, and
  Metal is enabled by default on macOS. However, server support is still the
  unmerged [PR #17956](https://github.com/ggml-org/llama.cpp/pull/17956).
  These are strong CLI compatibility signals, not evidence that this exact
  older community GGUF produces correct MADLAD translations on an M2 Pro.
- **All requested GGUF endpoints are currently anonymous and ungated.** An
  anonymous redirect-following `HEAD` request returned HTTP 200 for Tencent,
  `mtsdurica`, and `notjjustnumbers`; Hugging Face's model APIs also returned
  `private: false` and `gated: false`.
- The two proposed MADLAD community repositories contain **the same GGUF bytes**:
  size `1,858,124,864` and SHA-256
  `fc56f16d215db71e856de3c3770974c867e3d95a782d415d4cfabc9fb470b8e4`.
  Choosing between them does not change the model artifact.

“Source-level viable” above deliberately does not mean “benchmarked” or even
“smoke-tested.” No full model artifact was downloaded or executed for this
note.

## Exact input formats

### HY-MT1.5-1.8B

Tencent says language placeholders must be full language names, using English
names in the English instruction. For non-Chinese pairs, the exact prompt
template is:

```text
Translate the following segment into {target_language}, without additional explanation.

{source_text}
```

Therefore the two sanity prompts are:

```text
Translate the following segment into Spanish, without additional explanation.

The meeting is scheduled for next Tuesday afternoon.
```

```text
Translate the following segment into Dutch, without additional explanation.

The meeting is scheduled for next Tuesday afternoon.
```

These are Tencent's documented words and blank-line placement, not an inferred
generic translation prompt. The Chinese-involved template is different and is
also documented in the [Tencent repository at revision
`13c207d7`](https://github.com/Tencent-Hunyuan/HY-MT/blob/13c207d7ac1f93d54e96385a89bcd076d06a5579/README.md#prompts).

There are two documented Hunyuan runtime paths. They use the same embedded
template but are not byte-identical at the final control token: Tencent's
Transformers example explicitly sets `add_generation_prompt=False`, whereas
current `llama-cli` applies a generation prompt.

1. Tencent's [GGUF model
   card](https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/blob/265b2e615a7dc9b06c435dc878829ad99a512ba2/README.md)
   invokes `llama-cli -p` with the natural-language prompt above.
2. Tencent's Transformers example passes that prompt as one `user` message to
   `tokenizer.apply_chat_template(..., add_generation_prompt=False)`. The
   immutable [Jinja
   template](https://huggingface.co/tencent/HY-MT1.5-1.8B/blob/dbad03788f49709801014c95d481a514c272ca52/chat_template.jinja)
   adds Hunyuan-specific BOS/role/control tokens. Tencent explicitly says there
   is no default system prompt.

The GGUF embeds that Hunyuan template; Hugging Face's anonymous [model
API](https://huggingface.co/api/models/tencent/HY-MT1.5-1.8B-GGUF) exposes it
as `gguf.chat_template`. Current `llama-cli` automatically enables conversation
mode when a supported embedded template is present, turns `-p` into a `user`
message, and applies the template with a generation prompt
([current completion
code](https://github.com/ggml-org/llama.cpp/blob/91f8c9c5fb038c086e13e9cd823c29b33b07ba54/tools/completion/completion.cpp#L211-L238),
[formatting
path](https://github.com/ggml-org/llama.cpp/blob/91f8c9c5fb038c086e13e9cd823c29b33b07ba54/tools/completion/completion.cpp#L291-L315)).
Therefore Tencent's `llama-cli -p` command is **not** an unwrapped raw-token
path on the inspected llama.cpp version. Do not add Hunyuan control tokens
manually or apply the template twice. `-no-cnv` intentionally disables this
automatic wrapping and should be treated as a separate diagnostic, not silently
mixed into the canonical run. Smoke-test the documented CLI path directly
rather than assuming its token sequence is identical to the Transformers
example.

Tencent recommends sampling (`temperature 0.7`, `top_k 20`, `top_p 0.6` in the
README, with a slightly different `top_p 0.8` in the stored generation config).
For the requested deterministic comparison, `--temp 0` intentionally overrides
that recommendation. Current llama.cpp source makes temperature `<= 0` retain
only the highest-logit token, i.e. greedy selection ([sampler
implementation](https://github.com/ggml-org/llama.cpp/blob/91f8c9c5fb038c086e13e9cd823c29b33b07ba54/src/llama-sampler.cpp#L265-L283)).

Reproducible sanity commands:

```sh
llama-cli -hf tencent/HY-MT1.5-1.8B-GGUF:Q4_K_M \
  -p $'Translate the following segment into Spanish, without additional explanation.\n\nThe meeting is scheduled for next Tuesday afternoon.' \
  -n 256 --temp 0 --repeat-penalty 1.05 --no-warmup

llama-cli -hf tencent/HY-MT1.5-1.8B-GGUF:Q4_K_M \
  -p $'Translate the following segment into Dutch, without additional explanation.\n\nThe meeting is scheduled for next Tuesday afternoon.' \
  -n 256 --temp 0 --repeat-penalty 1.05 --no-warmup
```

### MADLAD-400-3B-MT

MADLAD is not instruction/chat prompted. Its input is the source sentence
prefixed with a target-language token:

```text
<2xx> {source_text}
```

The exact sanity inputs are:

```text
<2es> The meeting is scheduled for next Tuesday afternoon.
<2nl> The meeting is scheduled for next Tuesday afternoon.
```

The target token is mandatory. It selects the output language; the source
language is not separately named. This format is stated by the [Google-hosted
model card at immutable revision
`fa184c6`](https://huggingface.co/google/madlad400-3b-mt/blob/fa184c675da0b5c9e1c8694fccd4e12e2d422094/README.md#training-details)
and by the [official Transformers MADLAD
documentation](https://huggingface.co/docs/transformers/model_doc/madlad-400).

Do not use HY's natural-language instruction or a chat template for MADLAD.
Candidate commands, pending the required smoke test, are:

```sh
llama-cli -hf mtsdurica/madlad400-3b-mt-Q4_K_M-GGUF:Q4_K_M \
  -p '<2es> The meeting is scheduled for next Tuesday afternoon.' \
  -n 256 --temp 0

llama-cli -hf mtsdurica/madlad400-3b-mt-Q4_K_M-GGUF:Q4_K_M \
  -p '<2nl> The meeting is scheduled for next Tuesday afternoon.' \
  -n 256 --temp 0
```

The community card supplies a llama.cpp command, but its example prompt is
unrelated text and is not evidence of correct encoder-decoder translation. The
two commands above combine the card's repository/file selection with Google's
documented MADLAD input format.

## Architecture and provenance

| Property | HY-MT1.5-1.8B | MADLAD-400-3B-MT |
| --- | --- | --- |
| Publisher / origin | Tencent Hunyuan Team | Google Research |
| Architecture | Decoder-only `HunYuanDenseV1ForCausalLM` | T5 encoder-decoder `T5ForConditionalGeneration` |
| Relevant config | 32 decoder layers, hidden size 2,048, 16 attention heads, 4 KV heads, vocab 120,818, tied token/output embeddings | 32 encoder and 32 decoder layers, model width 1,024, FFN 8,192, 16 heads, vocab 256,000, configured input positions 512 |
| Training provenance | HY-1.8B-Base → MT continuous pretraining and SFT → on-policy distillation from HY-MT1.5-7B → reinforcement learning | MADLAD-400 and parallel data; the 3B MT release is trained on 1T tokens covering more than 450 languages |
| Proposed GGUF provenance | Official Tencent repository and quant | Community conversion of `google/madlad400-3b-mt` through llama.cpp/GGUF-my-repo |

Sources:

- HY's immutable [model
  config](https://huggingface.co/tencent/HY-MT1.5-1.8B/blob/dbad03788f49709801014c95d481a514c272ca52/config.json)
  and [technical report](https://arxiv.org/html/2512.24092#S2) establish the
  architecture parameters, base model, and training pipeline.
- The MADLAD [model
  config](https://huggingface.co/google/madlad400-3b-mt/blob/fa184c675da0b5c9e1c8694fccd4e12e2d422094/config.json),
  [Google Research checkpoint
  page](https://github.com/google-research/google-research/tree/master/madlad_400),
  and [paper](https://arxiv.org/abs/2309.04662) establish the architecture and
  original provenance.
- The Google-hosted Hugging Face card explicitly discloses that Juarez Bochi,
  who was not involved in the research, converted the original weights and
  wrote that card. The candidate
  [`mtsdurica`](https://huggingface.co/mtsdurica/madlad400-3b-mt-Q4_K_M-GGUF/blob/7f55e827c4c2fd1fdc52893879e18966d2867dba/README.md)
  and
  [`notjjustnumbers`](https://huggingface.co/notjjustnumbers/madlad400-3b-mt-Q4_K_M-GGUF/blob/b325d397b871d944f12cd98ddff3a969cc8fec6e/README.md)
  cards both identify `google/madlad400-3b-mt` as the base and GGUF-my-repo as
  the conversion route. They are community artifacts, not Google-signed
  llama.cpp releases.

An additional ungated `model-q4k.gguf` now exists inside
[`google/madlad400-3b-mt`](https://huggingface.co/google/madlad400-3b-mt/tree/fa184c675da0b5c9e1c8694fccd4e12e2d422094).
It is `1,654,597,280` bytes with SHA-256
`ea6e5531a3e95213c7f0635988d119e078a655c09306e47851e15d4c0c3f9c37`.
It is not the proposed Q4_K_M file and should not be substituted without a
separate quality/speed run.

## Runtime compatibility

### llama.cpp and Metal

T5/Flan-T5 inference entered upstream in
[`807b0c4`](https://github.com/ggml-org/llama.cpp/commit/807b0c49ff7071094f97ebc3a0a8e2b9e274f503);
the commit explicitly added encoder-decoder support to `llama-cli` and the
batched example. At inspected commit
[`91f8c9c`](https://github.com/ggml-org/llama.cpp/tree/91f8c9c5fb038c086e13e9cd823c29b33b07ba54):

- llama.cpp's [supported-model
  list](https://github.com/ggml-org/llama.cpp/blob/91f8c9c5fb038c086e13e9cd823c29b33b07ba54/README.md#models)
  includes Flan-T5 and Hunyuan.
- Its [architecture
  registry](https://github.com/ggml-org/llama.cpp/blob/91f8c9c5fb038c086e13e9cd823c29b33b07ba54/src/llama-arch.cpp)
  recognizes `t5`, `t5encoder`, `hunyuan-moe`, and `hunyuan-dense`.
- Its [T5 conversion
  code](https://github.com/ggml-org/llama.cpp/blob/91f8c9c5fb038c086e13e9cd823c29b33b07ba54/conversion/t5.py)
  registers `T5ForConditionalGeneration` and emits T5 GGUF metadata.
- Its [T5 model
  implementation](https://github.com/ggml-org/llama.cpp/blob/91f8c9c5fb038c086e13e9cd823c29b33b07ba54/src/models/t5.cpp)
  loads separate encoder/decoder layers and builds self-attention,
  cross-attention, encoder, and decoder graphs. The public API explicitly
  supports encoder output feeding decoder cross-attention
  ([`llama_encode`](https://github.com/ggml-org/llama.cpp/blob/91f8c9c5fb038c086e13e9cd823c29b33b07ba54/include/llama.h)).
- On macOS, [Metal is enabled by
  default](https://github.com/ggml-org/llama.cpp/blob/91f8c9c5fb038c086e13e9cd823c29b33b07ba54/docs/build.md#metal-build)
  and `--n-gpu-layers 0` explicitly disables GPU inference.

The interface boundary matters: current upstream `llama-server` does not
implement this encoder→decoder request flow. The open, unmerged
[server PR #17956](https://github.com/ggml-org/llama.cpp/pull/17956) describes
adding `llama_encode()`, decoder-start initialization, and disabling
incompatible caching/speculative features “matching the behavior of
llama-cli.” Therefore:

- use `llama-cli` or the libllama encoder/decoder API for the smoke test;
- do not treat a normal current `llama-server` launch as a supported MADLAD
  deployment;
- a product integration requiring the OpenAI-compatible server would need to
  wait for upstream, carry a fork, or implement the libllama flow itself.

Current source verifies that upstream CLI/libllama has the required
architecture and backend plumbing. It does **not** prove that every operation
in this specific MADLAD GGUF is Metal-offloaded, that its 2024-era conversion
metadata matches current expectations, or that output is correct. The
benchmark's first action should remain one en→es and one en→nl CLI smoke
translation while observing the startup log for Metal device/offload lines. If
either is gibberish, do not benchmark it until tokenizer, decoder-start token,
and encoder/decoder execution are confirmed.

HY has stronger model-specific evidence: Tencent itself calls the GGUF a
llama.cpp model and publishes a working-form invocation in the model card.
Even for HY, the cited sources do not contain an M2 Pro run, so performance and
actual offload remain empirical questions.

### Alternative runtimes for MADLAD

- **Transformers/PyTorch:** explicitly supported by the
  [Google-hosted card](https://huggingface.co/google/madlad400-3b-mt/blob/fa184c675da0b5c9e1c8694fccd4e12e2d422094/README.md#usage)
  and [Transformers
  docs](https://huggingface.co/docs/transformers/model_doc/madlad-400).
  PyTorch's [MPS backend](https://docs.pytorch.org/docs/stable/notes/mps.html)
  runs modules on Apple's GPU through Metal. **Inference:** MADLAD should be
  testable through Transformers on MPS, but none of the cited MADLAD sources
  certify every operation or the memory/performance of this 3B model on MPS.
- **CTranslate2:** its official documentation supports T5, including mT5 and
  Flan-T5, and converts Transformers checkpoints
  ([guide](https://opennmt.net/CTranslate2/guides/transformers.html#t5)).
  The merged
  [CTranslate2 PR #1552](https://github.com/OpenNMT/CTranslate2/pull/1552)
  specifically fixes MADLAD-400's differing decoder-start and pad tokens, so
  MADLAD compatibility is stronger than a generic T5 inference. Its prebuilt
  packages support macOS ARM64, while the installation guide limits GPU wheels
  to Linux/Windows with CUDA
  ([installation](https://opennmt.net/CTranslate2/installation.html#install-from-pypi)).
  On an M2 Pro, this is an Apple Accelerate/ARM CPU alternative, not a Metal
  alternative.
- **Candle:** the Google-hosted model card includes both normal and quantized T5
  commands using the required `<2de>` prefix. It is another plausible runtime,
  but the card does not establish Metal acceleration for this model.

## Licenses and shipping implications

### HY-MT1.5: Tencent HY Community License

The GGUF repository carries the official [Tencent HY Community License
Agreement](https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/blob/265b2e615a7dc9b06c435dc878829ad99a512ba2/License.txt).
Material terms relevant to this plugin include:

- The agreement says it does not apply in the EU, UK, or South Korea and defines
  “Territory” as the world excluding those places.
- The license grant and distribution rights apply only in the Territory.
  Section 5(c) also forbids using, reproducing, modifying, distributing, or
  displaying the works, outputs, or results outside the Territory.
- Distribution requires passing on the agreement, marking modified files, and
  including a prescribed `Notice` file. Products/services must prominently
  identify the actual provider and state that Tencent is not affiliated with or
  endorsing the product.
- A licensee with more than 100 million monthly active users across all products
  or services in the preceding month at the model release date needs a separate
  Tencent license.
- Outputs may not be used to improve a non-Tencent AI model, and the Acceptable
  Use Policy adds field-of-use restrictions.

This is not legal advice, but it is enough to reject an unrestricted global
catalog entry. The restriction covers use and output, not merely where the
download server is located.

### MADLAD-400: Apache License 2.0

The Google-hosted model card declares
[`apache-2.0`](https://huggingface.co/google/madlad400-3b-mt/blob/fa184c675da0b5c9e1c8694fccd4e12e2d422094/README.md#model-description),
and both candidate quant repositories repeat that license metadata. The
[Apache License 2.0 text](https://www.apache.org/licenses/LICENSE-2.0) has no
territorial exclusion analogous to Tencent's. Normal Apache distribution
conditions still apply, including providing the license and retaining
applicable notices.

The two community GGUF repositories contain only `.gitattributes`, a README,
and the GGUF; neither contains a standalone `LICENSE` file. If distributed by
the plugin, package the Apache license and attribution rather than relying only
on the Hugging Face card tag.

## Anonymous availability and integrity

The following commands were run without a Hugging Face token, cookies, or an
`Authorization` header. Both redirect-following `HEAD` and a one-byte range
`GET` succeeded; the latter returned HTTP 206 and exactly one byte:

```sh
curl -sS -L --range 0-0 -o /dev/null -w '%{http_code} %{size_download}\n' \
  'https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/main/HY-MT1.5-1.8B-Q4_K_M.gguf'
# 206 1

curl -sS -L --range 0-0 -o /dev/null -w '%{http_code} %{size_download}\n' \
  'https://huggingface.co/mtsdurica/madlad400-3b-mt-Q4_K_M-GGUF/resolve/main/madlad400-3b-mt-q4_k_m.gguf'
# 206 1

curl -sS -L --range 0-0 -o /dev/null -w '%{http_code} %{size_download}\n' \
  'https://huggingface.co/notjjustnumbers/madlad400-3b-mt-Q4_K_M-GGUF/resolve/main/madlad400-3b-mt-q4_k_m.gguf'
# 206 1
```

| Repository at check time | Revision | Private / gated | Artifact | Bytes | Git LFS SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `tencent/HY-MT1.5-1.8B-GGUF` | `265b2e615a7dc9b06c435dc878829ad99a512ba2` | false / false | `HY-MT1.5-1.8B-Q4_K_M.gguf` | 1,133,080,512 | `4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7` |
| `mtsdurica/madlad400-3b-mt-Q4_K_M-GGUF` | `7f55e827c4c2fd1fdc52893879e18966d2867dba` | false / false | `madlad400-3b-mt-q4_k_m.gguf` | 1,858,124,864 | `fc56f16d215db71e856de3c3770974c867e3d95a782d415d4cfabc9fb470b8e4` |
| `notjjustnumbers/madlad400-3b-mt-Q4_K_M-GGUF` | `b325d397b871d944f12cd98ddff3a969cc8fec6e` | false / false | `madlad400-3b-mt-q4_k_m.gguf` | 1,858,124,864 | `fc56f16d215db71e856de3c3770974c867e3d95a782d415d4cfabc9fb470b8e4` |

The public, unauthenticated Hugging Face APIs used to verify repository state
are:

- <https://huggingface.co/api/models/tencent/HY-MT1.5-1.8B-GGUF?blobs=true>
- <https://huggingface.co/api/models/mtsdurica/madlad400-3b-mt-Q4_K_M-GGUF?blobs=true>
- <https://huggingface.co/api/models/notjjustnumbers/madlad400-3b-mt-Q4_K_M-GGUF?blobs=true>

The hashes in the table are the `sha256` values in Hugging Face's Git LFS
metadata, also exposed by the raw LFS pointers. For a managed catalog, pin a
revision and verify this hash rather than resolving `main`. HEAD 200 plus the
one-byte GET 206 establish current anonymous availability while deliberately
avoiding a full artifact download; they do not promise that a community
repository will remain available or unchanged.

## Remaining empirical gates

The following cannot be established from primary source review and must be
measured:

1. MADLAD Q4_K_M loads under the exact selected llama.cpp build on the M2 Pro,
   executes both encoder and decoder through a sensible Metal/CPU split, and
   produces clean en→es and en→nl output.
2. HY Q4_K_M's documented `llama-cli -p` path, including the automatically
   applied embedded chat template, produces clean translations at greedy
   decoding despite Tencent recommending sampling.
3. Model load time, warm tokens/s, 500-word end-to-end latency, peak RSS, and
   output quality.
4. Whether either model preserves this plugin's segmented Markdown better than
   Bergamot.

Do not interpret generic architecture support, a Hugging Face “llama-cpp” tag,
or an anonymous-availability HTTP status as satisfying any of those gates.
