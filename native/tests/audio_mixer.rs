use local_dictation_sidecar::audio_mixer::{AudioMixer, MixedAudioFrame};
use local_dictation_sidecar::protocol::{PCM_BYTES_PER_FRAME, PCM_SAMPLE_RATE_HZ};

fn frame_with_sample(sample: i16) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(PCM_BYTES_PER_FRAME);
    for _ in 0..(PCM_BYTES_PER_FRAME / 2) {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn tone_frame(freq_hz: f32) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(PCM_BYTES_PER_FRAME);
    for index in 0..(PCM_BYTES_PER_FRAME / 2) {
        let t = index as f32 / PCM_SAMPLE_RATE_HZ as f32;
        let amplitude = 0.8 * (2.0 * std::f32::consts::PI * freq_hz * t).sin();
        let sample = (amplitude * i16::MAX as f32) as i16;
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn first_sample(frame: &MixedAudioFrame) -> i16 {
    i16::from_le_bytes([frame.frame_bytes[0], frame.frame_bytes[1]])
}

fn loudest_band(bands: &[f32]) -> usize {
    bands
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).expect("band levels are finite"))
        .map(|(index, _)| index)
        .expect("there is always at least one band")
}

#[test]
fn microphone_only_passes_through_one_frame_per_input_frame() {
    let mut mixer = AudioMixer::microphone_only("session-1");

    let output = mixer
        .push_microphone_frame(frame_with_sample(1200))
        .expect("frame should mix")
        .expect("mic frame should emit output");

    assert_eq!(output.session_id, "session-1");
    assert_eq!(first_sample(&output), 1200);
}

#[test]
fn microphone_with_system_emits_one_mixed_frame_on_microphone_tick() {
    let mut mixer = AudioMixer::microphone_with_system("session-1");

    assert!(
        mixer
            .push_system_frame(frame_with_sample(600))
            .expect("system frame should queue")
            .is_none(),
        "system frames must not advance the transcription timeline by themselves",
    );
    let output = mixer
        .push_microphone_frame(frame_with_sample(1000))
        .expect("mic frame should mix")
        .expect("mic frame should emit output");

    assert_eq!(first_sample(&output), 800);
}

#[test]
fn microphone_with_system_does_not_stall_when_system_frame_is_missing() {
    let mut mixer = AudioMixer::microphone_with_system("session-1");

    let output = mixer
        .push_microphone_frame(frame_with_sample(1000))
        .expect("mic frame should mix")
        .expect("mic frame should emit output");

    assert_eq!(first_sample(&output), 1000);
}

#[test]
fn microphone_with_system_clamps_without_overflow() {
    let mut mixer = AudioMixer::microphone_with_system("session-1");

    let _ = mixer
        .push_system_frame(frame_with_sample(i16::MAX))
        .expect("system frame should queue");
    let output = mixer
        .push_microphone_frame(frame_with_sample(i16::MAX))
        .expect("mic frame should mix")
        .expect("mic frame should emit output");

    assert_eq!(first_sample(&output), i16::MAX);
}

#[test]
fn band_levels_localize_a_tone_to_its_frequency_band() {
    let mut mixer = AudioMixer::microphone_only("session-1");

    // 3 kHz sits squarely inside band 4 (2–4 kHz), away from either edge.
    let output = mixer
        .push_microphone_frame(tone_frame(3000.0))
        .expect("frame should mix")
        .expect("mic frame should emit output");
    let bands = mixer.analyze_levels(&output.frame_bytes);

    assert_eq!(
        loudest_band(&bands),
        4,
        "a 3 kHz tone should peak band 4; bands: {bands:?}",
    );
    assert!(
        bands[4] > bands[0],
        "the tone's band should exceed the silent low band; bands: {bands:?}",
    );
}

#[test]
fn band_levels_report_silence_as_floor() {
    let mut mixer = AudioMixer::microphone_only("session-1");

    let output = mixer
        .push_microphone_frame(frame_with_sample(0))
        .expect("frame should mix")
        .expect("mic frame should emit output");
    let bands = mixer.analyze_levels(&output.frame_bytes);

    assert!(
        bands.iter().all(|&band| band == 0.0),
        "silence must gate every band to zero; bands: {bands:?}",
    );
}

#[test]
fn clear_discards_buffered_system_frames() {
    let mut mixer = AudioMixer::microphone_with_system("session-1");

    let _ = mixer
        .push_system_frame(frame_with_sample(600))
        .expect("system frame should queue");
    mixer.clear();
    let output = mixer
        .push_microphone_frame(frame_with_sample(1000))
        .expect("mic frame should mix")
        .expect("mic frame should emit output");

    assert_eq!(first_sample(&output), 1000);
}
