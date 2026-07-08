# Research: macOS Native System-Audio Capture (issue #159)

Status: research complete, no implementation decision recorded yet.
Issue: [#159](https://github.com/brittain9/local-dictation-obsidian-plugin/issues/159).
Scope: findings only, verified against primary sources (Apple SDK headers, Apple
docs/sample code, Chromium/Electron source, crate source). Every load-bearing
claim carries its source. Observations, inferences, and recommendations are
labeled where the distinction matters.

## Implications for #159 (summary)

- **API choice**: CoreAudio process taps (`CATapDescription` +
  `AudioHardwareCreateProcessTap` + tap-in-aggregate-device) are the right
  backend. Minimum macOS is **14.2** by Apple's own availability annotations and
  sample code, and Chromium ships exactly that gate. Older macOS keeps the
  existing `SystemAudioError::Unsupported` / virtual-device fallback.
- **TCC attribution works in our favor**: the sidecar is a plain child process
  of Obsidian, so TCC attributes the "record system audio" prompt and the
  persisted grant to **Obsidian.app** (the "responsible process"), not to the
  unsigned sidecar. The usage string must come from Obsidian's `Info.plist`
  (`NSAudioCaptureUsageDescription`). Electron ships that key in its default
  `Info.plist` since v39.6.0 (Feb 2026); Obsidian's 1.12.7 installer bundles
  Electron 39.8.3, so current installers should carry it — but **older
  installers won't**, and the failure mode without the key is a **silent dead
  stream (no prompt, no error)**. We must runtime-probe (Chromium's
  get/set-`kAudioTapPropertyDescription` trick) and surface guidance instead of
  producing zero-audio.
- **Binding route**: hand-rolled, dependency-light — `objc2` `msg_send!` for the
  `CATapDescription` class (runtime `AnyClass::get`, no link-time dep) plus
  `dlsym(RTLD_DEFAULT)` for the two 14.2-only C functions, with the
  long-standing aggregate-device C API linked normally. This is exactly the
  pattern of the Linux backend (dlopen'd libpulse) and is what
  seren-desktop/AFFiNE ship in production Rust. `objc2-core-audio` (small,
  MIT/Apache) is a reasonable alternative if we accept a link-time symbol
  dependency; `cidre` is complete but heavyweight.
- **Don't use ScreenCaptureKit**: it works (macOS 13+) but requires the Screen
  Recording TCC class, which macOS 15 nags about monthly. The tap API's
  dedicated "System Audio Recording Only" permission is prompt-once.
- **Electron renderer capture is now real** (Electron ≥ 39, CATap-backed
  `getDisplayMedia`) and would reuse our existing renderer→sidecar PCM path, but
  it depends on the user's *installer* Electron version, which Obsidian only
  updates on manual reinstall — not something the plugin can rely on. Keep the
  sidecar backend as the primary plan; note the renderer path as a possible
  future fallback.

---

## 1. CoreAudio process taps (the modern path)

### API surface and minimum versions

From the macOS 15.5 SDK headers
(`CoreAudio.framework/Headers/AudioHardwareTapping.h`, mirror:
<https://github.com/alexey-lysiuk/macos-sdk/blob/master/MacOSX15.5.sdk/System/Library/Frameworks/CoreAudio.framework/Versions/A/Headers/AudioHardwareTapping.h>):

```c
extern OSStatus
AudioHardwareCreateProcessTap(CATapDescription* inDescription,
                              AudioObjectID*  outTapID)  API_AVAILABLE(macos(14.2)) ...;
extern OSStatus
AudioHardwareDestroyProcessTap(AudioObjectID inTapID)    API_AVAILABLE(macos(14.2)) ...;
```

Note the whole header is wrapped in `#ifdef __OBJC__` — the declarations are
invisible to plain-C tooling (this matters for bindgen; see §4).

Per-symbol availability cross-checked against Apple's documentation JSON
(`developer.apple.com/tutorials/data/documentation/...`):

| Symbol | macOS availability | Source |
| --- | --- | --- |
| `AudioHardwareCreateProcessTap` | **14.2** | [docs](https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:)) |
| `AudioHardwareDestroyProcessTap` | **14.2** (header annotation) | header above |
| `CATapDescription` (class) | annotated **12.0** (docs and header agree) — but unusable before 14.2 because nothing public consumes it | [docs](https://developer.apple.com/documentation/coreaudio/catapdescription), header `CATapDescription.h` |
| `CATapDescription.muteBehavior` | annotated 12.0 (enum `CATapMuteBehavior` annotated `macos(13.0)` in header) | [docs](https://developer.apple.com/documentation/coreaudio/catapdescription/mutebehavior) |
| `NSAudioCaptureUsageDescription` (Info.plist key) | **14.2** | [docs](https://developer.apple.com/documentation/bundleresources/information-property-list/nsaudiocaptureusagedescription) |
| `kAudioAggregateDeviceTapListKey`, `kAudioSubTapUIDKey`, `kAudioTapProperty*`, process-object selectors | plain `#define`/enums, no annotations; absent from the 13.3 SDK's `AudioHardware.h`, present from the 14.x SDKs on (verified by diffing SDK mirrors) | SDK mirror diff (13.3 vs 14.5) |

**14.2 vs 14.4**: insidegui's AudioCap README claims "With macOS 14.4, Apple
introduced new API in CoreAudio…" and the repo description says "macOS 14.4+"
(<https://github.com/insidegui/AudioCap>). That conflicts with Apple's own
annotations (14.2), Apple's sample-code page ("ensure that you're using macOS
14.2 or later",
<https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps>)
and Chromium, which gates at 14.2
(`IsMacCatapSystemLoopbackCaptureSupported() { return MacOSVersion() >= 14'02'00; }`,
[media/base/media_switches.cc](https://github.com/chromium/chromium/blob/main/media/base/media_switches.cc)).
Recommendation: gate at **14.2** and rely on the runtime permission probe (§2)
rather than a version check for correctness; treat 14.2/14.3 as best-effort
(Chromium additionally works around a 14.x resampling bug, below).

### Setup sequence (validated by three independent implementations)

Apple's sample article ["Capturing system audio with Core Audio
taps"](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps),
AudioCap's
[`ProcessTap.swift`](https://github.com/insidegui/AudioCap/blob/main/AudioCap/ProcessTap/ProcessTap.swift)
and Chromium's
[`media/audio/mac/catap_audio_input_stream.mm`](https://github.com/chromium/chromium/blob/main/media/audio/mac/catap_audio_input_stream.mm)
all follow the same shape:

1. (Optional, per-process taps) translate PIDs to process objects with
   `kAudioHardwarePropertyTranslatePIDToProcessObject`
   ([docs](https://developer.apple.com/documentation/coreaudio/kaudiohardwarepropertytranslatepidtoprocessobject)).
2. Build a `CATapDescription`. For "everything the machine plays", use the
   global-tap initializers from `CATapDescription.h`:
   `initStereoGlobalTapButExcludeProcesses:` /
   `initMonoGlobalTapButExcludeProcesses:` (pass an empty array to exclude
   nothing, or your own process objects to avoid feedback). Set `name`,
   `privateTap = true` (Chromium: `setPrivate:YES`), read/assign the `UUID`.
   **`initMonoGlobalTapButExcludeProcesses:` is directly interesting for us**
   — the tap itself mixes to mono, halving what we must resample to the
   sidecar's 16 kHz mono frames.
3. `AudioHardwareCreateProcessTap(desc, &tapID)`. Chromium notes the call
   returns `kAudioObjectUnknown` as the tap ID "if the specified output device
   doesn't exist" (comment in `catap_audio_input_stream.mm`).
4. Create a **private aggregate device** whose
   `kAudioAggregateDeviceTapListKey` contains one dictionary:
   `{ kAudioSubTapUIDKey: <tap UUID string>, kAudioSubTapDriftCompensationKey: YES }`.
   Chromium's aggregate contains *only* the tap (no sub-devices) plus
   `kAudioAggregateDeviceIsPrivateKey: YES`, `kAudioAggregateDeviceTapAutoStartKey: NO`;
   AudioCap and cidre's example additionally list the current default output
   device under `kAudioAggregateDeviceSubDeviceListKey` and as
   `kAudioAggregateDeviceMainSubDeviceKey`. Both work; the tap-only aggregate
   is simpler and is what ships in Chrome.
5. Read the tap's format: `kAudioTapPropertyFormat` returns an
   `AudioStreamBasicDescription` — "the format of that data that will be
   accessible in any aggregate device that contains the tap"
   (`AudioHardware.h`; AudioCap `readAudioTapStreamBasicDescription()`).
6. `AudioDeviceCreateIOProcID` (or `...WithBlock`) on the aggregate device, then
   `AudioDeviceStart`. The IOProc's input buffer list carries the tap audio.
7. Teardown, in order (AudioCap `invalidate()`): `AudioDeviceStop` →
   `AudioDeviceDestroyIOProcID` → `AudioHardwareDestroyAggregateDevice` →
   `AudioHardwareDestroyProcessTap`.

### Default-output-device changes mid-capture

Primary source: Chromium's implementation, which distinguishes two modes
(comments on `kMacCatapCaptureAllDevices` in `catap_audio_input_stream.mm`):

- A **global tap with no `deviceUID` set** "captures all system audio,
  irrespective of the specific output device it's played on" — nothing to
  rebuild when the default device changes, at the cost of mixing every output
  device.
- Chromium's **default mode** pins the tap to the default output device by
  setting `tap_description_.deviceUID` and **rebuilds on change**: it installs
  an `AudioObjectAddPropertyListener` on
  `kAudioHardwarePropertyDefaultOutputDevice` and, via
  `OnDefaultDeviceChange() → RestartStream()`, tears down and recreates the
  whole source ("This stream is responsible for providing a seamless stream to
  the listener, even if there are changes to the default output device,
  achieved by reinitializing the `CatapAudioInputStreamSource` as needed" —
  class comment on `CatapAudioInputStream`). It also watches
  `kAudioDevicePropertyDeviceIsAlive` on the aggregate and errors out if the
  device dies.

Aggregates that embed the default output device as a sub-device (AudioCap
style) are pinned to that device and must likewise be rebuilt. **Inference for
us**: a device-less global mono tap is the simplest correct choice for
dictation (follow-the-audio semantics, no restart machinery); keep a
default-device listener only if we later pin to a device.

Sample-rate caveat: "On macOS 14, CATap does not handle sample rate mismatches,
making internal resampling necessary. This issue is resolved in macOS 15+"
(`kMacCatapSonomaInternalResampling` comment, `catap_audio_input_stream.mm`).
Safest plan: accept the tap's native format from `kAudioTapPropertyFormat` and
resample to 16 kHz mono ourselves (the repo already has
`native/src/system_audio/resample.rs`, currently `cfg(windows, test)`).

### Mute behavior

`CATapMuteBehavior` (`CATapDescription.h`): `CATapUnmuted = 0` (default; audio
captured *and* still played), `CATapMuted = 1` (captured, not played),
`CATapMutedWhenTapped = 2` (muted only while a client reads the tap). For
dictation we keep the default `CATapUnmuted`. Chromium maps its
"loopbackWithMute" device to `setMuteBehavior:CATapMuted`.

## 2. TCC / permission UX for process taps

### Which service, which prompt

- The Info.plist key is `NSAudioCaptureUsageDescription` — "A message that
  tells people why your app is requesting access to capture system audio on
  macOS", introduced macOS 14.2
  ([Apple docs](https://developer.apple.com/documentation/bundleresources/information-property-list/nsaudiocaptureusagedescription)).
- Prompt timing, per Apple's sample article: "The first time you start
  recording from an aggregate device that contains a tap, the system prompts
  you to grant the app system audio recording permission"
  ([Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)).
  Chromium's comment is more precise about the trigger point: "If this is the
  first time we're calling `AudioDeviceCreateIOProcID()`, this will trigger the
  macOS permission dialog. If the user doesn't respond to the dialog, this call
  will time out in 60 seconds. When this happens all interactions with
  CoreAudio will fail until the audio process is restarted"
  (`catap_audio_input_stream.mm`; Chromium literally kills its audio process on
  that timeout, feature `kMacCatapRestartAudioProcessOnTimeout`). **Design
  consequence for the sidecar**: run tap setup so that a wedged CoreAudio
  session can be recovered — worst case the sidecar process itself must be
  restartable, which our plugin already handles.
- The private TCC service name is `kTCCServiceAudioCapture`: AudioCap
  checks/requests it via `TCCAccessPreflight` / `TCCAccessRequest` from the
  private TCC framework
  ([`AudioRecordingPermission.swift`](https://github.com/insidegui/AudioCap/blob/main/AudioCap/ProcessTap/AudioRecordingPermission.swift)),
  because "There's no public API to request audio recording permission or to
  check if the app has that permission"
  ([AudioCap README](https://github.com/insidegui/AudioCap#permission)).
- Settings location on macOS 15+: System Settings → Privacy & Security →
  **"Screen & System Audio Recording"**; Apple's user guide: "You can allow
  apps to record both your screen and audio, or just your audio" (i.e. the pane
  hosts a separate system-audio-only list)
  ([Apple mac-help guide, macOS 15 selector](https://support.apple.com/guide/mac-help/mchld6aa7d23/15.0/mac/15.0)).
  `tccutil reset <service>` resets decisions per the macOS man page; the
  documented service name for screen recording is `ScreenCapture`, and the
  audio-capture service is `AudioCapture` (kTCCService prefix stripped) —
  *inference from the SPI service name; not verified on hardware in this
  research pass*.

### Missing usage description ⇒ silent failure, not a crash

The Electron project hit exactly this when Chromium made CATap the default:
"desktopCapturer abruptly stops working without the new plist entry… Electron's
`desktopCapturer` will create a **dead audio stream** if the new permission is
absent however **no errors or warnings will occur**"
([electron/electron#49717](https://github.com/electron/electron/pull/49717),
merged 2026-02, backported to 39/40/41). So unlike AVFoundation microphone
access (where a missing `NSMicrophoneUsageDescription` kills the app —
[Apple docs](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSMicrophoneUsageDescription)),
a missing `NSAudioCaptureUsageDescription` yields **no prompt and zero
audio**. This is the exact "silent zero-audio" trap #159 must design against.

### Who is the "responsible process" for our sidecar?

Quinn (Apple DTS), "On File System Permissions"
([developer.apple.com/forums/thread/678819](https://developer.apple.com/forums/thread/678819)):

> "The MAC privilege mechanism is heavily dependent on the concept of
> *responsible code*. For example, if an app contains a helper tool and the
> helper tool triggers a MAC prompt, we want: the app's name and usage
> description to appear in the alert; the user's decision to be recorded for
> the whole app, not that specific helper tool; that decision to show up in
> System Settings under the app's name."

A directly spawned child (our sidecar is `spawn()`ed by Obsidian's renderer
process) is attributed to the app; the chain only breaks if the child
"daemonizes itself" or is launched via launchd (fixable with
`AssociatedBundleIdentifiers`), or if the parent explicitly disclaims
responsibility (`responsibility_spawnattrs_setdisclaim`, which WebKit uses for
its helper processes — see
[Qt's write-up "The Curious Case of the Responsible Process"](https://www.qt.io/blog/the-curious-case-of-the-responsible-process)).
**Conclusion**: the TCC prompt and grant will carry Obsidian's name, icon and
usage string; the sidecar being unsigned is irrelevant to attribution. The
grant persists for Obsidian, so it survives sidecar restarts.

### Does Obsidian.app carry `NSAudioCaptureUsageDescription`?

Chain of evidence (no public dump of Obsidian's shipped plist was found):

- Electron's default `shell/browser/resources/mac/Info.plist` includes
  `NSMicrophoneUsageDescription` / `NSCameraUsageDescription` ("This app needs
  access to the microphone/camera") since 2019
  ([electron#19871](https://github.com/electron/electron/pull/19871)) and
  gained `NSAudioCaptureUsageDescription` = "This app needs access to audio
  capture" in
  [electron#49717](https://github.com/electron/electron/pull/49717)
  (main, 2026-02-10; 39-x-y backport
  [#49740](https://github.com/electron/electron/pull/49740) merged 2026-02-11,
  first shipped in **v39.6.0**, 2026-02-13 — release dates from the Electron
  releases API; commit `0aba4a6ab8` is an ancestor of v39.8.3).
- Obsidian 1.12.7 (2026-03-23): "The installer has been updated to use Electron
  v39.8.3" ([Obsidian changelog](https://obsidian.md/changelog/2026-03-23-desktop-v1.12.7/)).
- electron-builder-produced apps start from Electron's bundled plist and merge
  app-specific keys, so the default usage-description keys survive unless the
  vendor deletes them (observation of the packaging model; Obsidian is known to
  ship Electron's default mic string).

**Inference**: Obsidian installers ≥ 1.12.7 ship the key; anything on an older
installer base (Obsidian updates Electron **only** via installer reinstall, see
changelog note) does not, and will hit the silent-dead-stream path. First
implementation task on a Mac: `plutil -p /Applications/Obsidian.app/Contents/Info.plist`
to confirm.

### Pre-flighting permission state

- **Public-API probe (recommended; what Chrome ships)**: after creating the
  tap, read `kAudioTapPropertyDescription` and write it back; "If either of
  these operations fail, this function returns false which is an indication
  that we don't have system audio capture permission"
  (`CatapAudioInputStreamSource::ProbeAudioTapPermissions`,
  `catap_audio_input_stream.mm`; feature `kMacCatapProbeTapOnCreation`,
  enabled by default; failure maps to `OpenOutcome::kFailedSystemPermissions`).
  Note tap *creation itself succeeds without permission* — only the audio is
  withheld, hence the probe.
- **TCC SPI** (`TCCAccessPreflight`/`TCCAccessRequest` on
  `kTCCServiceAudioCapture` via dlopen of the private TCC framework): gives a
  true tri-state without instantiating a tap (AudioCap, link above). Private
  API; fine for a non-MAS sidecar, but a stability/App-Review liability. Our
  Linux backend already dlopens libpulse, so mechanically this is familiar —
  keep it optional if used at all.
- Map probe failure to a new `SystemAudioError` variant with guidance ("enable
  Obsidian under System Settings → Privacy & Security → Screen & System Audio
  Recording"), mirroring how `SystemAudioError::message()` already documents
  the virtual-device fallback (`native/src/system_audio/mod.rs`).

## 3. ScreenCaptureKit audio (the alternative)

- `SCStreamConfiguration.capturesAudio` and `excludesCurrentProcessAudio` are
  macOS **13.0+**; `captureMicrophone` and `SCRecordingOutput` are macOS
  **15.0+**; `SCContentSharingPicker` is macOS 14.0+ (Apple docs JSON
  availability:
  [capturesAudio](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturesaudio),
  [captureMicrophone](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturemicrophone),
  [SCRecordingOutput](https://developer.apple.com/documentation/screencapturekit/screcordingoutput),
  [SCContentSharingPicker](https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker)).
- **Audio-only capture is possible** — Chromium's SCK loopback adds only an
  `SCStreamOutputTypeAudio` output and notes: "All settings related to video
  capture must remain at their default values, otherwise a video sample stream
  output must also be added"
  ([media/audio/mac/audio_loopback_input_mac_impl.mm](https://github.com/chromium/chromium/blob/main/media/audio/mac/audio_loopback_input_mac_impl.mm)).
  No video frames are delivered, but a display `SCContentFilter` (from
  `SCShareableContent`) is still required.
- **Permission**: the framework overview instructs "Request screen recording
  permission from the person before capturing content" via
  `NSScreenCaptureUsageDescription`
  ([ScreenCaptureKit overview](https://developer.apple.com/documentation/screencapturekit));
  Chromium treats `SCShareableContent` retrieval failure as
  `kFailedSystemPermissions` (same file). There is **no SCK system-audio-only
  mode that avoids the Screen Recording TCC class** — audio-only SCK still
  rides the screen-recording grant; Apple's system-audio-only permission is
  the Core Audio tap service from §2. (macOS 15's picker,
  `SCContentSharingPicker`, avoids the TCC prompt but requires interactive
  content selection per session — unusable for a background dictation source.)
- **macOS 15 re-approval nags**: Sequoia betas prompted weekly to re-confirm
  screen-recording apps, changed to monthly by beta 6 and further relaxed in
  15.1 ("Applications using our deprecated content capture technologies now
  have enhanced user awareness policies" — Apple 15.1 beta release note quoted
  by press;
  [MacRumors](https://www.macrumors.com/2024/08/15/macos-sequoia-screen-recording-app-permissions/),
  [9to5Mac](https://9to5mac.com/2024/10/07/macos-sequoia-screen-recording-popups/);
  prompt text: "…requesting to bypass the system private window picker and
  directly access your screen and audio…"). Apple added the
  [`com.apple.developer.persistent-content-capture`](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.persistent-content-capture)
  entitlement (macOS 15.0+) for VNC-class apps to opt out — not attainable for
  an unsigned sidecar. SCK capture also lights the screen-sharing menu-bar
  indicator. **This recurring-nag UX is disqualifying for a dictation feature
  when the tap API exists**; Chromium itself now prefers CATap and keeps SCK
  loopback only for macOS < 15
  (`IsMacSckSystemLoopbackCaptureSupported() { return MacOSVersion() < 15'00'00 || …; }`,
  media_switches.cc).

## 4. Rust bindings landscape

- **`coreaudio-sys` (0.2.18)**: bindgen runs at build time in **C mode** over
  the umbrella `CoreAudio/CoreAudio.h`
  ([build.rs](https://github.com/RustAudio/coreaudio-sys/blob/master/build.rs)).
  Because `AudioHardwareTapping.h`/`CATapDescription.h` are `#ifdef __OBJC__`,
  **`AudioHardwareCreateProcessTap` and `CATapDescription` are not generated**;
  the plain-C aggregate/tap constants (`kAudioAggregateDeviceTapListKey`,
  `kAudioSubTapUIDKey`, `kAudioTapPropertyFormat`, `AudioHardwareCreateAggregateDevice`,
  `AudioDeviceCreateIOProcID*`, …) *are* available **iff the build machine's
  SDK is ≥ 14.x** (bindings are SDK-dependent at compile time). AFFiNE builds
  on exactly this split: constants from `coreaudio::sys`, tap functions via
  hand-rolled `unsafe extern "C"`, `CATapDescription` via `objc2::msg_send!`
  ([tap_audio.rs](https://github.com/toeverything/AFFiNE/blob/canary/packages/frontend/native/media_capture/src/macos/tap_audio.rs),
  [ca_tap_description.rs](https://github.com/toeverything/AFFiNE/blob/canary/packages/frontend/native/media_capture/src/macos/ca_tap_description.rs)).
- **`objc2-core-audio` (0.3.2, MIT/Apache-2.0/Zlib, auto-generated by the
  objc2 project)**: exposes the full set —
  [`AudioHardwareCreateProcessTap`](https://docs.rs/objc2-core-audio/latest/objc2_core_audio/fn.AudioHardwareCreateProcessTap.html)
  / `AudioHardwareDestroyProcessTap` (as `unsafe extern "C-unwind"` fns, feature
  `AudioHardware` + `objc2`), `CATapDescription`, `kAudioTapPropertyFormat`,
  `AudioHardwareCreateAggregateDevice`, `AudioDeviceCreateIOProcID`. Caveat:
  the tap functions are ordinary link-time imports with no weak-linking
  support, so a sidecar binary that *calls through the crate's extern* carries
  a hard symbol dependency — fine only if the symbol exists on our minimum
  supported macOS, which it does **not** (sidecar must still run for mic
  dictation on macOS < 14.2). Usable if we route those two calls through
  `dlsym` ourselves and use the crate for constants/class glue.
- **`cidre` (0.16.0, MIT, active, `rust-version = 1.88`, edition 2024)**: the
  most complete bindings — `TapDesc` with all six initializers
  ([tap_description.rs](https://github.com/yury/cidre/blob/main/cidre/src/core_audio/tap_description.rs)),
  `Tap`/`TapGuard` RAII incl. `asbd()` for `kAudioTapPropertyFormat`
  ([hardware_tapping.rs](https://github.com/yury/cidre/blob/main/cidre/src/core_audio/hardware_tapping.rs)),
  and a complete ~100-line system-audio recorder example
  ([examples/core-audio-record](https://github.com/yury/cidre/blob/main/cidre/examples/core-audio-record/main.rs)).
  Great as *reference code*; as a dependency it drags in a very large
  multi-framework crate, against this repo's dependency posture.
- **`screencapturekit` crate (8.0.0)** exists and is maintained, but only
  matters if we chose SCK (§3 says don't).
- **Recommended route (matches repo style)**: hand-rolled backend file like
  `windows.rs`/`linux.rs`:
  - `objc2` + `objc2-foundation` for `CATapDescription` via
    `AnyClass::get(c"CATapDescription")` + `msg_send!` — runtime lookup returns
    `None` on old macOS instead of a load failure (AFFiNE pattern), or
    `extern_class!` as seren-desktop does;
  - the two 14.2-only functions resolved with
    `dlsym(RTLD_DEFAULT, "AudioHardwareCreateProcessTap")` at first use,
    returning `SystemAudioError::Unsupported` when absent — precedent:
    [seren-desktop `src-tauri/src/audio/capture/macos.rs`](https://github.com/serenorg/seren-desktop/blob/main/src-tauri/src/audio/capture/macos.rs)
    ("Resolve them lazily via `dlsym` instead and report `Unsupported` when
    absent");
  - long-standing C API (`AudioHardwareCreateAggregateDevice`,
    `AudioDeviceCreateIOProcID`, `AudioObjectGetPropertyData`, `AudioDeviceStart/Stop`)
    via a small `extern "C"` block (or `objc2-core-audio` for its constants).
  MSRV/edition: repo is edition 2024 / rust 1.94.1 (`native/Cargo.toml`);
  `objc2` 0.6.x and `objc2-core-audio` 0.3.x are comfortably below that.

## 5. Electron/Chromium loopback (completeness check)

- **Chromium**: system-audio loopback on macOS is implemented twice — SCK-based
  (`media/audio/mac/audio_loopback_input_mac_impl.mm`, macOS 13+) and
  CATap-based (`media/audio/mac/catap_audio_input_stream.{h,mm}`, macOS 14.2+).
  Current main: `kMacCatapLoopbackAudioForScreenShare` is
  `FEATURE_ENABLED_BY_DEFAULT` and SCK is only "supported" below macOS 15
  ([media_switches.cc](https://github.com/chromium/chromium/blob/main/media/base/media_switches.cc)).
  So `getDisplayMedia({audio:…})`-driven system audio on modern macOS goes
  through the same tap API + `NSAudioCaptureUsageDescription` + audio-capture
  TCC service described in §§1–2.
- **Electron**: the [desktopCapturer docs](https://www.electronjs.org/docs/latest/api/desktop-capturer)
  state that "As of Electron v39.0.0-beta.4, Chromium made Apple's CoreAudio
  Tap API the default for desktop audio capture", that
  `NSAudioCaptureUsageDescription` is required, and that the absence of the key
  produces a dead stream with no errors
  ([PR #49717](https://github.com/electron/electron/pull/49717)); apps can
  revert via `disable-features=MacCatapLoopbackAudioForScreenShare`. (The
  [session.md](https://github.com/electron/electron/blob/main/docs/api/session.md)
  note that the `audio: 'loopback'` *string shortcut* is Windows-only is about
  that specific handler API, not about macOS loopback overall.)
- **Obsidian**: ships Electron 39.8.3 in the 1.12.7 installer
  ([changelog](https://obsidian.md/changelog/2026-03-23-desktop-v1.12.7/)), so
  a renderer-side `getDisplayMedia` system-audio capture is *technically
  plausible today* and would flow into our existing renderer→sidecar PCM
  protocol unchanged. But: (a) it depends on the **installer** Electron, which
  users update only by reinstalling; (b) the plugin cannot install the
  display-media request handler (that's app code; Obsidian would have to wire
  it — plugins only get `navigator.mediaDevices`, and `getDisplayMedia` without
  a handler fails in Electron); (c) picker/permission behavior is outside our
  control. **Recommendation**: not viable as the primary mechanism; revisit
  only if Obsidian exposes a display-media handler.

## 6. Prior art to crib from

| Project | Language / shape | What to take |
| --- | --- | --- |
| [insidegui/AudioCap](https://github.com/insidegui/AudioCap) — [`ProcessTap.swift`](https://github.com/insidegui/AudioCap/blob/main/AudioCap/ProcessTap/ProcessTap.swift), [`AudioRecordingPermission.swift`](https://github.com/insidegui/AudioCap/blob/main/AudioCap/ProcessTap/AudioRecordingPermission.swift) | Swift app | Canonical minimal tap+aggregate lifecycle; TCC SPI preflight; teardown ordering (`invalidate()`) |
| Chromium [`media/audio/mac/catap_audio_input_stream.mm`](https://github.com/chromium/chromium/blob/main/media/audio/mac/catap_audio_input_stream.mm) (+`catap_api.h` seam for testing) | C++/ObjC++, production | Permission probe (`ProbeAudioTapPermissions`), default-device-change restart, 60 s prompt-timeout hazard, mono/stereo + resampling strategy per macOS version, tap-only aggregate dict |
| [yury/cidre `examples/core-audio-record`](https://github.com/yury/cidre/blob/main/cidre/examples/core-audio-record/main.rs) + [`core_audio/hardware_tapping.rs`](https://github.com/yury/cidre/blob/main/cidre/src/core_audio/hardware_tapping.rs) | Rust | Complete end-to-end Rust recorder; RAII guards over tap/aggregate |
| [AFFiNE `media_capture/src/macos/tap_audio.rs`](https://github.com/toeverything/AFFiNE/blob/canary/packages/frontend/native/media_capture/src/macos/tap_audio.rs), [`ca_tap_description.rs`](https://github.com/toeverything/AFFiNE/blob/canary/packages/frontend/native/media_capture/src/macos/ca_tap_description.rs) | Rust NAPI module inside an **Electron** app | Closest overall architecture to ours: coreaudio-sys constants + hand-rolled extern + `objc2 msg_send!` class glue; device/property-listener handling |
| [serenorg/seren-desktop `src-tauri/src/audio/capture/macos.rs`](https://github.com/serenorg/seren-desktop/blob/main/src-tauri/src/audio/capture/macos.rs) | Rust (Tauri) | The `dlsym(RTLD_DEFAULT)` lazy-resolution pattern for the 14.2-only symbols — the exact portability trick our single-binary sidecar needs |
| Chromium [`media/audio/mac/audio_loopback_input_mac_impl.mm`](https://github.com/chromium/chromium/blob/main/media/audio/mac/audio_loopback_input_mac_impl.mm) | C++/ObjC++ | Only if SCK ever becomes relevant: audio-only SCK stream configuration |

Other Rust codebases found using `AudioHardwareCreateProcessTap` (GitHub code
search, 2026-07): snolab/CapsLockX, pathorsAI/parley, majorsimon/midium,
rankun203/meeting-notes, zouwei/moraya, fluxerapp/fluxer, khawkins98/Hush,
kenotron-ms/side-huddle, djgould/audio-tap-tauri-example — all follow either
the AFFiNE (extern + msg_send) or cidre route; none surfaced problems beyond
the permission/attribution issues documented above.
