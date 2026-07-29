# Bergamot CJK HTML alignment runtime

> **Investigation only — do not release.** The remaining semantic tag-boundary
> failure and upstream ownership decision are tracked in
> [issue #345](https://github.com/brittain9/speech-kit-obsidian-plugin/issues/345).
> This directory preserves the reproducible experiment; the production fix
> should be accepted in `mozilla/translations` rather than maintained here as a
> permanent engine fork.

This directory contains the Bergamot WebAssembly runtime used by the translation
model catalog. The JavaScript glue and WebAssembly module are one generated pair
and must be distributed together.

## Source

- Upstream: [`mozilla/translations`](https://github.com/mozilla/translations)
- Commit: `eea6e5a80aa4ddd86d9cc35ce9a65b79aa3ab96d`
  (`v0.6.0+eea6e5a8`)
- Local source changes: [`cjk-html-alignment.patch`](cjk-html-alignment.patch)
- License: [MPL-2.0](MPL-2.0.txt)

The patch corrects Bergamot's HTML word-alignment smoothing for target
languages that do not delimit words with ASCII spaces. The upstream heuristic
otherwise treats an entire Japanese or Chinese sentence as one word and moves
every inline tag to the first target token. It also keeps CJK punctuation out
of unrelated inline elements when decoder attention points at punctuation
inside those elements.

## Reproduction

The build uses the upstream-pinned Emscripten SDK 3.1.8 submodule at
`2346baa7bb44a4a0571cc75f1986ab9aaa35aa03`.

```bash
git clone https://github.com/mozilla/translations.git
cd translations
git checkout eea6e5a80aa4ddd86d9cc35ce9a65b79aa3ab96d
git submodule update --init --checkout --recursive
git apply /path/to/cjk-html-alignment.patch
python3 inference/scripts/build-wasm.py --clobber
```

Upstream's build script predates CMake 4. With CMake 4, add
`-DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DUSE_DOXYGEN=OFF` to its `emcmake cmake`
invocation. This build-tool compatibility adjustment does not change the
checked-in source patch.

The script compiles the runtime, imports the WASM GEMM module, and wraps the
generated JavaScript for Firefox's `loadBergamot(Module)` interface. Do not
combine this JavaScript with a different WebAssembly module.

Expected release artifacts:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `bergamot-translator-v0.6.0-cjk-html.js` | 91,412 | `2816751cf574004384e2af1ad04b8fe389f3518cb2094988aed05ffb5abbbd2e` |
| `bergamot-translator-v0.6.0-cjk-html.wasm` | 4,965,936 | `37f17e9c2d16c2f81b42d5f0aac9f5b34c071ad8dcdb6b737a2a94fc937243a5` |

## Native regression tests

The source patch adds coverage for Japanese tag placement, mixed-script terms
such as `Ctrl+S`, and inserted Japanese punctuation. Build the upstream native
tests and run:

```bash
inference/build/src/tests/units/run_html_tests
```
