//! Investigative diarization probe (not a CI gate).
//!
//! Runs hard, multi-speaker audio through the *real* pipeline
//! (VAD → whisper → online diarization) via [`driver::diarize_in_process`] and
//! prints what the diarizer actually produced. It exists to characterise the
//! current per-utterance diarizer's behaviour on conversational audio, where
//! many speaker turns share one VAD utterance.
//!
//! Both tests are `#[ignore]`d: they need a whisper model and are diagnostics,
//! not assertions. Run them explicitly:
//!
//! ```sh
//! STT_TEST_WHISPER_MODEL=/path/to/ggml-tiny.en.bin \
//! DIARIZE_WAV=/path/to/clip_16k_mono.wav \
//!   cargo test --manifest-path native/Cargo.toml --test diarization_realworld \
//!   -- --ignored --nocapture probe_realworld_clip
//! ```

mod common;

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use common::manifest::Corpus;
use common::{audio, driver, model};
use local_dictation_sidecar::session::SpeakingStyle;

const SAMPLES_PER_MS: usize = 16;
const SAMPLES_PER_FRAME: usize = 320; // 20 ms @ 16 kHz

fn style_from_env() -> SpeakingStyle {
    match std::env::var("DIARIZE_STYLE").ok().as_deref() {
        Some("responsive") => SpeakingStyle::Responsive,
        Some("patient") => SpeakingStyle::Patient,
        _ => SpeakingStyle::Balanced,
    }
}

fn distinct_speakers(speakers: &[Option<u32>]) -> usize {
    speakers.iter().flatten().collect::<HashSet<_>>().len()
}

/// Run one real clip (DIARIZE_WAV, 16 kHz mono 16-bit) through the full pipeline
/// and print the per-utterance speaker labels and text.
#[test]
#[ignore = "investigative probe; needs DIARIZE_WAV + a whisper model"]
fn probe_realworld_clip() {
    let wav =
        std::env::var("DIARIZE_WAV").expect("set DIARIZE_WAV to a 16 kHz mono 16-bit wav clip");
    let model_path = model::require_whisper_model();
    let samples = audio::decode_wav_16k_mono(Path::new(&wav)).expect("decode DIARIZE_WAV");
    let audio_ms = samples.len() / SAMPLES_PER_MS;
    let frames = audio::samples_to_frames(&samples);
    let style = style_from_env();

    let outcome = driver::diarize_in_process(&model_path, &frames, style);

    let mut per_speaker: BTreeMap<i64, usize> = BTreeMap::new();
    for speaker in &outcome.speakers {
        *per_speaker
            .entry(speaker.map(i64::from).unwrap_or(-1))
            .or_default() += 1;
    }

    eprintln!("\n=== diarization probe: {wav} ===");
    eprintln!(
        "audio={:.1}s style={style:?} utterances={} distinct_speakers_predicted={}",
        audio_ms as f64 / 1000.0,
        outcome.utterance_count,
        distinct_speakers(&outcome.speakers),
    );
    eprintln!("utterances per predicted speaker (-1 = unassigned): {per_speaker:?}");
    let segment_distinct = outcome
        .labeled_segments
        .iter()
        .filter_map(|(speaker, _)| *speaker)
        .collect::<HashSet<_>>()
        .len();
    eprintln!(
        "SEGMENT-level distinct speakers = {segment_distinct} over {} labelled segments",
        outcome.labeled_segments.len(),
    );
    eprintln!("stopped={} errors={:?}", outcome.stopped, outcome.errors);
    eprintln!("--- who said what (segment-level) ---");
    for (i, (speaker, text)) in outcome.labeled_segments.iter().enumerate() {
        let label = speaker.map_or_else(|| "S?".to_string(), |s| format!("S{s}"));
        eprintln!("[{i:>3}] {label:<4} {text}");
    }
}

/// Controlled causal proof: the *same* set of distinct speakers, interleaved as
/// turns, separated by either a generous gap (VAD finalises one utterance per
/// turn) or a tight gap (turns merge into one utterance). Ground truth is exact
/// — each turn is a known corpus speaker — so the collapse is unambiguous.
#[test]
#[ignore = "investigative probe; needs a whisper model"]
fn probe_gap_sweep() {
    let model_path = model::require_whisper_model();
    let corpus = Corpus::load();
    let speakers: Vec<(String, Vec<i16>)> = corpus
        .fixtures
        .iter()
        .map(|f| {
            (
                f.id.clone(),
                audio::decode_wav_16k_mono(&f.audio_path()).expect("decode fixture"),
            )
        })
        .collect();
    let true_speaker_count = speakers.len();

    // Two turns per speaker, interleaved round-robin so every voice leaves and
    // returns — the live property a returning speaker must keep its id.
    let halves: Vec<(String, Vec<Vec<i16>>)> = speakers
        .iter()
        .map(|(id, s)| {
            let mid = s.len() / 2;
            (id.clone(), vec![s[..mid].to_vec(), s[mid..].to_vec()])
        })
        .collect();

    for (label, gap_frames) in [("generous_2.0s_gap", 100usize), ("tight_0.3s_gap", 15usize)] {
        let mut samples: Vec<i16> = Vec::new();
        let mut truth: Vec<String> = Vec::new();
        for turn in 0..2 {
            for (id, chunks) in &halves {
                samples.extend_from_slice(&chunks[turn]);
                samples.extend(std::iter::repeat_n(0i16, gap_frames * SAMPLES_PER_FRAME));
                truth.push(id.clone());
            }
        }
        let frames = audio::samples_to_frames(&samples);
        let outcome = driver::diarize_in_process(&model_path, &frames, SpeakingStyle::Balanced);

        let segment_distinct = outcome
            .labeled_segments
            .iter()
            .filter_map(|(speaker, _)| *speaker)
            .collect::<HashSet<_>>()
            .len();
        eprintln!(
            "\n[{label}] true_speakers={true_speaker_count} true_turns={} \
             produced_utterances={} utterance_distinct={} SEGMENT_distinct={segment_distinct}",
            truth.len(),
            outcome.utterance_count,
            distinct_speakers(&outcome.speakers),
        );
        eprintln!("  per-utterance dominant sequence: {:?}", outcome.speakers);
    }
}
