# CUDA setup

CUDA gives Whisper and Cohere Transcribe a large speedup on NVIDIA GPUs. Published CUDA release archives bundle the CUDA runtime libraries Whisper needs, so most users only need a recent NVIDIA driver — no CUDA Toolkit. macOS uses Metal automatically and needs none of this.

This guide covers enabling CUDA on Windows and Linux, and building from source.

## Requirements

- A Turing-or-newer NVIDIA GPU (RTX 20-series / GTX 16-series or newer) with a driver compatible with CUDA 13.x (R580 or newer).
- The CUDA sidecar variant, installed from the plugin — or CUDA Toolkit `13.2` with `nvcc` to build from source.
- For **Cohere** on CUDA: cuDNN `9.x` runtime libraries built for CUDA 13 (9.20 or newer). Without them, Cohere falls back to CPU; Whisper CUDA still works.

## Whisper vs Cohere

The two engines take different CUDA paths. Whisper uses whisper.cpp's CUDA backend, and the bundled runtime libraries are enough. Cohere uses ONNX Runtime's CUDA provider, which additionally needs cuDNN 9.x — if it's missing or mismatched, the sidecar says so in Settings and runs Cohere on CPU instead of pretending CUDA worked. The Cohere decoder always runs on CPU by design (an ONNX Runtime `GroupQueryAttention` limitation), regardless of platform.

## Windows

No sandbox, so this is straightforward.

1. Install the CUDA sidecar variant from **Settings → Local Dictation** (sidecar section), or build from source (below).
2. Confirm the driver, and cuDNN if you want Cohere on CUDA:
   ```powershell
   nvidia-smi
   where.exe cudnn64_9.dll
   ```
3. Under **Engine options**, leave **GPU acceleration** on **Use when available**.
4. Run **Local Dictation: Check sidecar health**, then confirm Settings reports `Whisper: CUDA` and `Cohere: CUDA`.

## Linux (native)

On a native install the sidecar inherits the host environment, so there's usually nothing to configure. Install the CUDA variant, make sure the NVIDIA driver and `libcuda.so.1` are present (plus cuDNN 9.x for Cohere), and confirm health as above. The `CUDA library path` setting exists for non-standard installs but isn't normally needed.

## Linux (Flatpak)

Flatpak hides the host `/usr`, and a global `LD_LIBRARY_PATH` breaks Electron's audio capture, so it needs a few extra steps.

1. Expose the host filesystem and GPU, then fully restart Obsidian:
   ```sh
   flatpak override --user --filesystem=host-os md.obsidian.Obsidian
   flatpak override --user --device=all md.obsidian.Obsidian
   ```
2. In **Settings → Local Dictation → Advanced: Sidecar**, set **CUDA library path** to the colon-separated host library directories. Use resolved real paths (from `readlink -f /usr/local/cuda`), not the `/usr/local/cuda` symlink — symlinks break across the sandbox boundary. This scopes `LD_LIBRARY_PATH` to the sidecar child process only. For example:
   ```text
   /run/host/usr/local/cuda-13.2/targets/x86_64-linux/lib:/run/host/usr/local/cuda-13.2/lib64:/run/host/usr/lib64
   ```
3. If the sidecar isn't auto-discovered inside the sandbox, set **Sidecar path override** to the CUDA binary.
4. Run **Local Dictation: Check sidecar health** and confirm `Whisper: CUDA` / `Cohere: CUDA`.

Don't set `LD_LIBRARY_PATH` as a global Flatpak override — it makes Electron load host audio libraries and breaks the microphone (`NotReadableError: Could not start audio source`). Use the plugin's `CUDA library path` setting instead.

## Building from source

Needs CUDA Toolkit `13.2` with `nvcc` on `PATH` (and cuDNN 9.x for Cohere).
CUDA 13.2 supports GCC host compilers through GCC 15; on Linux the build script
prefers `/usr/bin/gcc-15` and `/usr/bin/g++-15` when they are installed.

```sh
bash scripts/build-cuda.sh            # Linux        (add --release for release)
npm run build:sidecar:cuda:windows    # Windows      (append :release for release)
```

Artifacts:

- CPU: `native/target/{debug|release}/local-dictation-sidecar[.exe]`
- CUDA: `native/target-cuda/{debug|release}/local-dictation-sidecar[.exe]`

The Linux CUDA build also stages the ONNX Runtime provider libraries and CUDA
runtime libraries next to the binary — keep them together. A repo checkout
auto-detects the CUDA debug build at `native/target-cuda/debug`, so no path
override is needed when testing from source.

## Troubleshooting

**Settings show `Whisper: CPU`.** The sidecar couldn't load the CUDA runtime or see a GPU. Check `nvidia-smi`, confirm the plugin points at the CUDA sidecar (not the CPU build), and — on Flatpak — that `--device=all` exposed the device nodes:

```sh
flatpak run --command=sh md.obsidian.Obsidian -c 'ls /dev/nvidia* 2>&1'
```

**Settings show `Cohere: CPU (CUDA unavailable: ...)`.** ONNX Runtime couldn't register the CUDA provider. Usual causes: missing cuDNN 9.x (it must be built for CUDA 13 — a CUDA-12 build of `cudnn64_9.dll` / `libcudnn.so.9` is found by name but fails at runtime), missing bundled runtime libraries, or a driver/runtime mismatch. Whisper may still report CUDA because its dependency set is smaller.

**(Flatpak) Sidecar fails to start with missing CUDA libraries.** Confirm `--filesystem=host-os` is set, the library path uses the resolved `cuda-13.x` directory rather than `/usr/local/cuda`, and the driver library directory is included.
