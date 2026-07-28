pub mod bergamot_wasm;

#[cfg(any(
    feature = "engine-cohere-transcribe",
    feature = "engine-moonshine",
    feature = "engine-nemotron-asr",
    feature = "engine-pocket-tts",
    feature = "engine-supertonic"
))]
pub mod onnx;

#[cfg(feature = "engine-whisper")]
pub mod whisper_cpp;
