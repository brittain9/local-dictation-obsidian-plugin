# Linux support

Speech Kit supports desktop Obsidian on x86-64 GNU/Linux. The plugin UI runs inside Obsidian, while transcription runs in a native sidecar built for the `x86_64-unknown-linux-gnu` target.

## What is supported

| Area | Support boundary |
| --- | --- |
| CPU transcription | x86-64, glibc-based distributions with a new enough runtime for the current release build |
| NVIDIA acceleration | x86-64 with a Turing-or-newer GPU and a CUDA 13-compatible driver; see [CUDA setup](cuda-setup.md) |
| Microphone capture | Obsidian/Electron's audio input through PulseAudio or PipeWire |
| System audio | The default output monitor through PulseAudio, or PipeWire's PulseAudio compatibility service |
| Obsidian packages | Native packages and the Flathub build; sandbox changes are needed only when permissions were restricted or CUDA needs host libraries |

ARM64, 32-bit Linux, musl-only systems such as Alpine, and mobile Obsidian are not release targets. The project does not yet publish a frozen minimum glibc version. NixOS and other distributions that do not run ordinary glibc binaries are best-effort rather than first-class until the project has a tested packaging path for them.

## Current test coverage

- Fedora 44 KDE is used for day-to-day native testing and has also been exercised through Flatpak.
- Ubuntu has been exercised in a standard virtual-machine install.
- Every change builds and tests the sidecar on GitHub's current Ubuntu runner.
- Linux system-audio integration tests are available, but hardware-dependent cases are not part of routine pull-request CI.

Other x86-64 glibc distributions should work when their audio service exposes the same interfaces, but they are compatibility targets rather than a claim of distro-specific verification. A useful Linux bug report includes the distribution, architecture, Obsidian package, desktop session, audio server, and whether microphone-only dictation works.

## Native Obsidian packages

AppImage, Debian-package, and tarball installs all run outside a Flatpak sandbox. Install Speech Kit normally, complete its setup wizard, and start with the CPU sidecar. The published sidecar loads `libpulse-simple.so.0` only when system audio is enabled, so microphone dictation does not require that library.

For system audio, verify that the PulseAudio-compatible service is available and exposes a monitor source:

```sh
pactl info
pactl get-default-sink
pactl list short sources | grep '\.monitor'
```

On a PipeWire desktop, `pactl info` should identify the PulseAudio compatibility server. Package names differ across distributions; install or enable the distribution's `pipewire-pulse` equivalent rather than replacing a working PipeWire setup with a second audio server.

## Flatpak Obsidian

The [Flathub package](https://github.com/flathub/md.obsidian.Obsidian) is verified by the Obsidian team but maintained outside Obsidian's supported installers. Its default permissions include home-directory and PulseAudio access, which are the permissions Speech Kit normally needs for a vault and audio capture. Flatpak's [`pulseaudio` socket permission](https://docs.flatpak.org/en/latest/sandbox-permissions.html) covers microphone, playback, and audio-device access.

If those permissions were tightened with Flatseal or `flatpak override`, inspect the effective configuration:

```sh
flatpak info --show-permissions md.obsidian.Obsidian
```

Restore PulseAudio access only when it is missing:

```sh
flatpak override --user --socket=pulseaudio md.obsidian.Obsidian
```

The CPU sidecar does not need broad host filesystem or device access. CUDA is different because the sandbox must expose host driver libraries and GPU devices; follow the [Flatpak CUDA steps](cuda-setup.md#linux-flatpak) instead of adding global environment overrides.

Do not set a global `LD_LIBRARY_PATH` Flatpak override. Electron can load incompatible host audio libraries and then fail to open the microphone. The plugin's **CUDA library path** setting scopes that environment change to the sidecar process.

## Troubleshooting

### No microphone is detected

Speech Kit obtains microphone audio through Obsidian/Electron, not through the sidecar. Confirm that the device is enabled in the desktop sound settings, then fully restart Obsidian after permission changes. For Flatpak, confirm that the `pulseaudio` socket has not been removed.

If the error is `NotReadableError`, close other applications using the device and remove any global Flatpak `LD_LIBRARY_PATH` override before retrying.

### System audio is unavailable

First turn off **Include system audio**. If microphone-only dictation works, the model and sidecar are healthy and the failure is limited to the output-monitor path.

Then check `pactl info` and the monitor-source command above. Speech Kit records `@DEFAULT_MONITOR@`; a missing default sink, missing `libpulse-simple.so.0`, stopped PulseAudio compatibility service, or removed Flatpak audio permission will prevent that source from opening.

### The sidecar does not start

Run **Speech Kit: Check sidecar health** from the command palette. On an unsupported architecture, use a supported x86-64 machine; selecting a different model cannot change the sidecar architecture.

For a sandboxed install, avoid pointing **Sidecar path override** at a host path that is not visible inside the sandbox. The managed CPU sidecar is installed inside the plugin directory and should not need an override.

### Reporting a Linux problem

Open a bug report and include:

- Speech Kit and Obsidian versions
- distribution and version, CPU architecture, and kernel
- Obsidian package source (AppImage, Debian package, tarball, Flatpak, or other)
- desktop and session (for example, KDE Plasma 6 on Wayland)
- `pactl info` server name when the problem involves audio
- CPU or CUDA sidecar, selected model, and the exact error
- whether microphone-only dictation works with system audio disabled

Enable **Developer mode** in Speech Kit settings for verbose diagnostics. Review logs before posting them and remove unrelated local paths or note content.
