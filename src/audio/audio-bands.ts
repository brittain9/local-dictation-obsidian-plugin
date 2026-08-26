/**
 * The band-metering contract shared between a band source (the
 * {@link SidecarAudioLevelMeter}) and the ribbon renderer. The sidecar computes
 * the spectral bands and emits them on `audio_level`; both sides agree on this
 * count, which must match the fixed-length `bands` tuple on the wire
 * (`AudioLevelEvent` in `../sidecar/protocol`, `[f32; 6]` in the sidecar).
 */
export const BAND_COUNT = 6;

export interface AudioBandReader {
  /** Returns smoothed band levels in [0, 1], length {@link BAND_COUNT}, or null when no source is bound. */
  readBands(): Readonly<Float32Array> | null;
}
