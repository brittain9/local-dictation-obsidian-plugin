//! End-to-end speaker-diarization accuracy suite.
//!
//! The diarization analogue of `transcription_e2e.rs`: known speakers in, correct
//! speaker grouping out. It drives real speech from the reference corpus through
//! the actual [`SessionDiarizer`](local_dictation_sidecar::diarize) — the bundled
//! WeSpeaker embedding model plus the online clustering registry — and scores the
//! predicted speaker labels against ground truth.
//!
//! Unlike the transcription suite this is **hermetic**: the embedding model is
//! bundled in the binary (no download), so it runs in the normal `cargo test`
//! pass as a real quality gate rather than `#[ignore]`. Run with output:
//!
//! ```sh
//! cargo test --manifest-path native/Cargo.toml --test diarization_accuracy -- --nocapture
//! ```

mod common;

use std::collections::HashSet;
use std::time::Instant;

use common::diarize::{self, Utterance};
use common::manifest::Corpus;
use common::{audio, driver, model};
use local_dictation_sidecar::session::SpeakingStyle;

/// Samples per millisecond at the sidecar's 16 kHz rate.
const SAMPLES_PER_MS: usize = 16;

/// Loose upper bound on diarization's real-time factor (processing time over
/// audio duration), including the one-time embedding-model load. Diarization is
/// a small embedding inference per utterance and must stay well below real time
/// so it never becomes the pipeline's bottleneck. The bound is generous on
/// purpose — it catches gross regressions (an accidental O(n²) or a per-call
/// model reload) without flaking on slow or loaded CI hosts; the measured value
/// is printed for tracking as the feature is refined.
const MAX_REAL_TIME_FACTOR: f64 = 1.0;

/// Minimum cluster purity *and* coverage for a clean, well-separated
/// conversation. Together (the standard diarization diagnostic pair) they pin
/// down correct diarization from both sides: purity guards against merging two
/// speakers, coverage against splitting one across clusters. Read speech from
/// distinct speakers is the easy case for the embedding model, so the bar is
/// deliberately high — regressions below it are real.
const CLUSTERING_BUDGET: f64 = 0.95;

/// Build a conversation by splitting each single-speaker reference clip into
/// `segments_per_speaker` utterances and interleaving them round-robin, so every
/// voice leaves and returns after the others speak. This exercises the property
/// that matters live: a returning speaker must reclaim its original id rather
/// than spawn a duplicate.
fn interleaved_conversation(segments_per_speaker: usize) -> Vec<Utterance> {
    let segmented: Vec<(String, Vec<Vec<f32>>)> = diarize::speaker_sources()
        .into_iter()
        .map(|source| {
            let segments = diarize::split(&source.samples, segments_per_speaker);
            (source.speaker, segments)
        })
        .collect();

    let mut conversation = Vec::new();
    for segment_index in 0..segments_per_speaker {
        for (speaker, segments) in &segmented {
            conversation.push(Utterance {
                speaker: speaker.clone(),
                samples: segments[segment_index].clone(),
            });
        }
    }
    conversation
}

#[test]
fn interleaved_speakers_cluster_into_the_right_count_with_high_purity() {
    let conversation = interleaved_conversation(2);
    let result = diarize::diarize_scenario(&conversation);

    eprintln!(
        "[diarization] utterances={} true_speakers={} predicted_speakers={} purity={:.3} coverage={:.3} (budget {:.3})\n{}",
        result.len(),
        result.true_speaker_count(),
        result.predicted_speaker_count(),
        result.purity(),
        result.coverage(),
        CLUSTERING_BUDGET,
        result.trace(),
    );

    assert_eq!(
        result.predicted_speaker_count(),
        result.true_speaker_count(),
        "diarizer inferred {} speakers but the conversation has {}",
        result.predicted_speaker_count(),
        result.true_speaker_count(),
    );
    assert!(
        result.purity() >= CLUSTERING_BUDGET,
        "cluster purity {:.3} fell below budget {CLUSTERING_BUDGET:.3}",
        result.purity(),
    );
    assert!(
        result.coverage() >= CLUSTERING_BUDGET,
        "cluster coverage {:.3} fell below budget {CLUSTERING_BUDGET:.3}",
        result.coverage(),
    );
}

#[test]
fn one_voice_split_across_many_utterances_stays_a_single_speaker() {
    // Take the longest reference clip and chop it into several utterances; every
    // segment is the same speaker, so the registry must never split it.
    let source = diarize::speaker_sources()
        .into_iter()
        .max_by_key(|utterance| utterance.samples.len())
        .expect("the corpus has at least one clip");
    let speaker = source.speaker.clone();

    let utterances: Vec<Utterance> = diarize::split(&source.samples, 4)
        .into_iter()
        .map(|samples| Utterance {
            speaker: speaker.clone(),
            samples,
        })
        .collect();

    let result = diarize::diarize_scenario(&utterances);
    eprintln!("[diarization:stability]\n{}", result.trace());

    assert_eq!(
        result.predicted_speaker_count(),
        1,
        "a single voice was split into {} speakers",
        result.predicted_speaker_count(),
    );
    assert!((result.purity() - 1.0).abs() < f64::EPSILON);
}

#[test]
fn diarization_runs_well_under_real_time() {
    let sources = diarize::speaker_sources();
    let audio_ms = (sources
        .iter()
        .map(|utterance| utterance.samples.len())
        .sum::<usize>()
        / SAMPLES_PER_MS)
        .max(1) as f64;

    let started = Instant::now();
    let result = diarize::diarize_scenario(&sources);
    let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
    let real_time_factor = elapsed_ms / audio_ms;

    eprintln!(
        "[diarization:perf] utterances={} audio={:.1}s elapsed={:.0}ms rtf={:.3} (budget {:.3})",
        result.len(),
        audio_ms / 1_000.0,
        elapsed_ms,
        real_time_factor,
        MAX_REAL_TIME_FACTOR,
    );

    assert!(
        real_time_factor < MAX_REAL_TIME_FACTOR,
        "diarization real-time factor {real_time_factor:.3} exceeded budget {MAX_REAL_TIME_FACTOR:.3}",
    );
}

#[test]
fn distinct_voices_each_get_their_own_speaker() {
    // One full clip per distinct speaker, in corpus order. Every utterance is a
    // new voice, so the count must equal the number of distinct speakers and
    // each cluster must be pure.
    let utterances = diarize::speaker_sources();
    let expected = utterances.len();

    let result = diarize::diarize_scenario(&utterances);
    eprintln!("[diarization:separation]\n{}", result.trace());

    assert_eq!(
        result.predicted_speaker_count(),
        expected,
        "expected {expected} distinct speakers, got {}",
        result.predicted_speaker_count(),
    );
    assert!(
        (result.purity() - 1.0).abs() < f64::EPSILON,
        "distinct full clips should cluster perfectly, purity={:.3}",
        result.purity(),
    );
}

/// The deliberately-confusable fixtures, mined from LibriSpeech test-clean as
/// the corpus's closest cross-speaker pair: two female voices whose clean
/// embedding cosine (~0.38) sits just under the 0.4 new-speaker threshold. They
/// make the clean gates harder (the model must still split a near-threshold
/// pair). The noise gate excludes them on purpose: a pair this close is at the
/// model's discrimination limit, so any perturbation can tip it over — that is
/// out of scope for "noise must not break *distinguishable* voices", and is
/// documented instead by [`the_most_confusable_voices_still_separate_when_clean`].
const CONFUSABLE_FIXTURE_IDS: [&str; 2] = ["4446-2271-0004", "4992-23283-0005"];

/// Signal-to-noise ratio (dB) for the noise-robustness gate. 10 dB is audibly
/// noisy but still clearly intelligible speech — a realistic floor for a usable
/// microphone or system-audio capture, well below the studio-clean fixtures.
const NOISE_SNR_DB: f32 = 10.0;

/// Clustering budget under noise. Embeddings degrade as SNR drops, so this is
/// looser than the clean budget; the gate still demands the right speaker count
/// and a strong majority of utterances attributed correctly from both sides.
const NOISY_CLUSTERING_BUDGET: f64 = 0.90;

#[test]
fn the_most_confusable_voices_still_separate_when_clean() {
    let pair: Vec<Utterance> = diarize::speaker_sources()
        .into_iter()
        .filter(|source| CONFUSABLE_FIXTURE_IDS.contains(&source.speaker.as_str()))
        .collect();
    assert_eq!(
        pair.len(),
        CONFUSABLE_FIXTURE_IDS.len(),
        "both confusable fixtures must be present in the corpus"
    );

    let result = diarize::diarize_scenario(&pair);
    // The second assignment's similarity is the cross-speaker cosine — the
    // margin to the 0.4 threshold this gate protects.
    eprintln!(
        "[diarization:confusable] cross_speaker_cosine={:.3}\n{}",
        result.similarity[1],
        result.trace(),
    );

    assert_eq!(
        result.predicted_speaker_count(),
        2,
        "the corpus's closest pair (~0.38 cosine) must stay distinct in clean audio",
    );
}

#[test]
fn distinct_speakers_still_separate_under_moderate_noise() {
    // Representative, distinguishable voices only — the near-threshold confusable
    // pair is excluded (see CONFUSABLE_FIXTURE_IDS).
    let noisy: Vec<Utterance> = diarize::speaker_sources()
        .into_iter()
        .filter(|source| !CONFUSABLE_FIXTURE_IDS.contains(&source.speaker.as_str()))
        .map(|source| Utterance {
            samples: diarize::with_white_noise(&source.samples, NOISE_SNR_DB),
            speaker: source.speaker,
        })
        .collect();
    let expected = noisy.len();

    let result = diarize::diarize_scenario(&noisy);
    eprintln!(
        "[diarization:noise] snr={NOISE_SNR_DB}dB speakers={}/{} purity={:.3} coverage={:.3} (budget {:.3})\n{}",
        result.predicted_speaker_count(),
        expected,
        result.purity(),
        result.coverage(),
        NOISY_CLUSTERING_BUDGET,
        result.trace(),
    );

    assert_eq!(
        result.predicted_speaker_count(),
        expected,
        "under {NOISE_SNR_DB} dB noise the diarizer found {} speakers, expected {expected}",
        result.predicted_speaker_count(),
    );
    assert!(
        result.purity() >= NOISY_CLUSTERING_BUDGET,
        "noisy purity {:.3} fell below budget {NOISY_CLUSTERING_BUDGET:.3}",
        result.purity(),
    );
    assert!(
        result.coverage() >= NOISY_CLUSTERING_BUDGET,
        "noisy coverage {:.3} fell below budget {NOISY_CLUSTERING_BUDGET:.3}",
        result.coverage(),
    );
}

/// The true end-to-end gate: real audio in, transcript text *and* a speaker
/// label out, through the whole sidecar (VAD → whisper → diarization) in one
/// session. The hermetic tests above isolate the clustering; this proves the
/// speaker index is computed and survives all the way to the `transcript_ready`
/// event the plugin consumes. `#[ignore]`d for the same reason as
/// `transcription_e2e`: it needs a whisper model and real inference.
#[test]
#[ignore = "needs a whisper model + real inference; run with --ignored"]
fn full_pipeline_separates_distinct_speakers_in_one_session() {
    let model_path = model::require_whisper_model();
    let corpus = Corpus::load();

    // One continuous session: every distinct-speaker clip back to back, each
    // followed by trailing silence so the VAD finalizes an utterance per clip.
    let mut frames = Vec::new();
    for fixture in &corpus.fixtures {
        let samples = audio::decode_wav_16k_mono(&fixture.audio_path())
            .unwrap_or_else(|error| panic!("decoding fixture {}: {error}", fixture.id));
        frames.extend(audio::fixture_frames_with_trailing_silence(&samples));
    }
    let expected_speakers = corpus.fixtures.len();

    let outcome = driver::diarize_in_process(&model_path, &frames, SpeakingStyle::Patient);

    eprintln!(
        "[diarization:e2e] utterances={} speakers={:?} stopped={} errors={:?}\n    text: {}",
        outcome.utterance_count, outcome.speakers, outcome.stopped, outcome.errors, outcome.text,
    );

    assert!(
        outcome.errors.is_empty(),
        "session emitted errors: {:?}",
        outcome.errors,
    );
    assert!(outcome.stopped, "session never reached session_stopped");
    assert!(
        !outcome.text.trim().is_empty(),
        "the session produced an empty transcript"
    );

    // With diarization on, every transcribed utterance must carry a speaker.
    assert!(
        outcome.speakers.iter().all(Option::is_some),
        "some utterances were not assigned a speaker: {:?}",
        outcome.speakers,
    );

    // The pipeline must recover exactly the distinct voices it was given: fewer
    // means two speakers were merged, more means one voice was over-split.
    let distinct = outcome
        .speakers
        .iter()
        .flatten()
        .collect::<HashSet<_>>()
        .len();
    assert_eq!(
        distinct, expected_speakers,
        "full pipeline distinguished {distinct} speakers across the session, expected {expected_speakers}",
    );
}
