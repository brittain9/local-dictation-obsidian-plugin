#[cfg(any(feature = "engine-cohere-transcribe", feature = "engine-moonshine"))]
pub mod onnx;

#[cfg(feature = "engine-whisper")]
pub mod whisper_cpp;
