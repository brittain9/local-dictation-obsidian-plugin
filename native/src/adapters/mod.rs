pub mod firefox_translations;

#[cfg(feature = "engine-cohere-transcribe")]
pub mod cohere_transcribe;

#[cfg(feature = "engine-moonshine")]
pub mod moonshine;

#[cfg(feature = "engine-nemotron-asr")]
pub mod nemotron_asr;

#[cfg(feature = "engine-pocket-tts")]
pub mod pocket_tts;

#[cfg(feature = "engine-whisper")]
pub mod whisper;

#[cfg(feature = "engine-supertonic")]
pub mod supertonic;
