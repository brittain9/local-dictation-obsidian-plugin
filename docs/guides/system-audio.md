# System Audio Capture

Local Dictation can transcribe **this computer's audio output** — the remote
side of a meeting or call, a video, a podcast — instead of, or in addition to,
your microphone. The captured audio runs through the same on-device VAD →
transcription pipeline as the microphone, so it stays fully local.

There are two ways to get there:

1. **Native "System audio" source (Windows).** Built in, zero setup. Pick it in
   Settings and dictate.
2. **Virtual audio device (any platform).** Route your system output through a
   loopback device that shows up as a microphone, then select it in the normal
   microphone picker. Works on macOS and Linux today, and on Windows when you
   want to capture a single app rather than the whole output.

## Native System audio (Windows)

On Windows the sidecar captures the **default output device** directly via
WASAPI loopback — whatever you hear through your speakers or headphones.

1. Open **Settings → Local Dictation → Transcription**.
2. Set **Audio source** to **System audio**.
3. Start dictation as usual.

The microphone is not used in this mode. To go back to dictating with your
voice, set **Audio source** back to **Microphone**.

Notes:

- It captures the device that is the Windows *default output* when the session
  starts. Switch your default output (or use the per-app method below) to
  capture something else.
- Nothing playing means nothing to transcribe — start your meeting or media
  first.

## Virtual audio device (macOS, Linux, per-app on Windows)

The idea: create a virtual output device, send the audio you want to transcribe
into it, and select its **monitor / loopback input** as your microphone in
Settings → Transcription → Microphone.

### macOS

Install [BlackHole](https://github.com/ExistentialAudio/BlackHole) (free) or
[Loopback](https://rogueamoeba.com/loopback/) (paid, friendlier).

- To transcribe system audio only: set your system **Output** to BlackHole, then
  pick **BlackHole** as the microphone in Local Dictation. (You won't hear the
  audio yourself unless you build a Multi-Output Device that includes both
  BlackHole and your speakers — see BlackHole's README.)

### Linux (PipeWire / PulseAudio)

Most modern distros run PipeWire with PulseAudio compatibility, so the monitor
of your output already exists.

- In `pavucontrol` → **Recording**, while Local Dictation is capturing, set its
  stream's source to **Monitor of \<your output device>**.
- Or create a dedicated sink and capture its monitor:

  ```sh
  pactl load-module module-null-sink sink_name=dictation \
    sink_properties=device.description=Dictation
  ```

  Send the app you want into the `Dictation` sink (via `pavucontrol` →
  **Playback**), then select **Monitor of Dictation** as the microphone.

### Windows (per-app or virtual cable)

The native source above covers whole-output capture. Use a virtual cable when
you want to isolate a single application:

- Install [VB-CABLE](https://vb-audio.com/Cable/) (or VoiceMeeter for routing
  several apps), set the target app's output to **CABLE Input**, and select
  **CABLE Output** as the microphone in Local Dictation.

## Capturing your voice *and* the call together

To get both sides of a conversation in one transcript, mix your microphone and
the system audio into a single virtual device, then select that device:

- **macOS:** an [Aggregate / Multi-Output Device](https://support.apple.com/en-us/HT202000)
  or Loopback combining your mic and BlackHole.
- **Linux:** load a `module-null-sink` and `module-loopback` your mic plus the
  output monitor into it, then capture its monitor.
- **Windows:** VoiceMeeter, mixing your mic and the system output onto one
  virtual output.

Heads-up on echo: with echo cancellation off (the default, for clean
dictation), mixing a *live* call doubles up — your voice arrives both directly
from the mic and echoed back through the call. For meetings, pairing this with
speaker diarization helps separate who said what; for clean notes, prefer
capturing one source at a time.
