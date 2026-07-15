//! No-Python Nemotron 3.5 ASR buffered RNNT adapter.
//!
//! The graph contract and inference behavior follow the pinned Apache-2.0
//! sherpa-onnx exporter/runtime and NVIDIA NeMo frontend recorded in the Stage
//! A artifact document. This is a native Rust implementation over this
//! project's existing ONNX Runtime, not a sherpa-onnx or NeMo binding.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use ndarray::{Array1, Array2, Array3, Array4};
use ort::session::Session;
use ort::value::{
    DynValue, PrimitiveTensorElementType, Tensor, TensorElementType, Value, ValueType,
};
use realfft::RealFftPlanner;

use crate::engine::capabilities::{
    LanguageSupport, ModelFamilyCapabilities, ModelFamilyId, RuntimeId,
};
use crate::engine::traits::{LoadedModel, ModelFamilyAdapter, StreamingModel};
use crate::protocol::{TimestampGranularity, TimestampSource, TranscriptSegment};
use crate::runtimes::onnx::build_session;
use crate::transcription::{
    EngineTranscriptOutput, GpuConfig, TranscriptionError, validate_model_path,
};

const SAMPLE_RATE: usize = 16_000;
const FRAME_SHIFT_SAMPLES: usize = 160;
const FRAME_LENGTH_SAMPLES: usize = 400;
const FFT_SIZE: usize = 512;
const FFT_BINS: usize = FFT_SIZE / 2 + 1;
const STFT_WINDOW_OFFSET: usize = (FFT_SIZE - FRAME_LENGTH_SAMPLES) / 2;
const FEATURE_DIM: usize = 128;
const PREEMPHASIS_COEFFICIENT: f32 = 0.97;
const LOG_ZERO_GUARD: f32 = 1.0 / 16_777_216.0;
const MAX_SYMBOLS_PER_FRAME: usize = 10;
const EN_US_PROMPT_INDEX: i64 = 0;
const AUTO_PROMPT_INDEX: usize = 101;
const EXPECTED_CHUNK_SIZE_MS: usize = 560;
const EXPECTED_WINDOW_SIZE: usize = 65;
const EXPECTED_CHUNK_SHIFT: usize = 56;
const EXPECTED_SUBSAMPLING_FACTOR: usize = 8;
const EXPECTED_ENCODER_DIM: usize = 1_024;
const EXPECTED_CACHE_CHANNEL_LAYERS: usize = 24;
const EXPECTED_CACHE_CHANNEL_TIME: usize = 56;
const EXPECTED_CACHE_TIME_WIDTH: usize = 8;
const EXPECTED_PREDICTOR_LAYERS: usize = 2;
const EXPECTED_PREDICTOR_HIDDEN: usize = 640;
const EXPECTED_VOCAB_SIZE: usize = 13_088;

const ENCODER_FILENAME: &str = "encoder.int8.onnx";
const DECODER_FILENAME: &str = "decoder.int8.onnx";
const JOINER_FILENAME: &str = "joiner.int8.onnx";
const TOKENS_FILENAME: &str = "tokens.txt";
const MODEL_TYPE: &str = "EncDecRNNTBPEModelWithPrompt";

const CAPABILITIES: ModelFamilyCapabilities = ModelFamilyCapabilities {
    supports_segment_timestamps: false,
    supports_word_timestamps: false,
    supports_initial_prompt: false,
    supports_streaming: true,
    supports_language_selection: false,
    supported_languages: LanguageSupport::EnglishOnly,
    max_audio_duration_secs: None,
    produces_punctuation: true,
};

#[derive(Default)]
pub struct NemotronAsrAdapter;

impl ModelFamilyAdapter for NemotronAsrAdapter {
    fn runtime_id(&self) -> RuntimeId {
        RuntimeId::OnnxRuntime
    }

    fn family_id(&self) -> ModelFamilyId {
        ModelFamilyId::NemotronAsr
    }

    fn capabilities(&self) -> &ModelFamilyCapabilities {
        &CAPABILITIES
    }

    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError> {
        let paths = resolve_model_paths(path)?;
        let encoder = build_session(&paths.encoder, GpuConfig { use_gpu: false })
            .map_err(invalid_session("encoder"))?;
        let config = NemotronConfig::from_encoder(&encoder)?;
        let decoder = build_session(&paths.decoder, GpuConfig { use_gpu: false })
            .map_err(invalid_session("decoder"))?;
        let joiner = build_session(&paths.joiner, GpuConfig { use_gpu: false })
            .map_err(invalid_session("joiner"))?;
        verify_graph_topology(&encoder, &decoder, &joiner, &config)?;
        let tokenizer = NemotronTokenizer::load(&paths.tokens)?;
        tokenizer.validate(config.vocab_size)?;
        Ok(())
    }

    fn load(
        &self,
        _path: &Path,
        _gpu: GpuConfig,
    ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
        Err(TranscriptionError::unsupported_engine(
            "Nemotron 3.5 ASR requires the streaming session path".to_string(),
        ))
    }

    fn load_streaming(
        &self,
        path: &Path,
        gpu: GpuConfig,
    ) -> Result<Box<dyn StreamingModel>, TranscriptionError> {
        Ok(Box::new(LoadedNemotronModel::load(path, gpu)?))
    }
}

fn invalid_session(graph: &'static str) -> impl FnOnce(TranscriptionError) -> TranscriptionError {
    move |error| {
        TranscriptionError::invalid_model_with_details(format!(
            "{graph} session failed to load: {}",
            error.details.unwrap_or_else(|| error.message.to_string())
        ))
    }
}

struct ModelPaths {
    encoder: PathBuf,
    decoder: PathBuf,
    joiner: PathBuf,
    tokens: PathBuf,
}

fn resolve_model_paths(path: &Path) -> Result<ModelPaths, TranscriptionError> {
    validate_model_path(path)?;
    if path.file_name() != Some(OsStr::new(ENCODER_FILENAME)) {
        return Err(TranscriptionError::invalid_model_with_details(format!(
            "Nemotron 3.5 ASR external models must be selected via {ENCODER_FILENAME}; received {}",
            path.display()
        )));
    }

    let directory = path.parent().ok_or_else(|| {
        TranscriptionError::invalid_model_with_details(
            "cannot determine the Nemotron 3.5 ASR model directory".to_string(),
        )
    })?;
    let paths = ModelPaths {
        encoder: path.to_path_buf(),
        decoder: directory.join(DECODER_FILENAME),
        joiner: directory.join(JOINER_FILENAME),
        tokens: directory.join(TOKENS_FILENAME),
    };

    for required in [&paths.decoder, &paths.joiner, &paths.tokens] {
        validate_model_path(required).map_err(|_| {
            TranscriptionError::invalid_model_with_details(format!(
                "required Nemotron 3.5 ASR asset missing: {}",
                required.display()
            ))
        })?;
    }
    Ok(paths)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NemotronConfig {
    vocab_size: usize,
    feature_dim: usize,
    window_size: usize,
    chunk_shift: usize,
    subsampling_factor: usize,
    encoder_dim: usize,
    cache_channel_layers: usize,
    cache_channel_time: usize,
    cache_time_width: usize,
    predictor_layers: usize,
    predictor_hidden: usize,
}

impl NemotronConfig {
    fn from_encoder(encoder: &Session) -> Result<Self, TranscriptionError> {
        let metadata = encoder.metadata().map_err(|error| {
            TranscriptionError::invalid_model_with_details(format!(
                "failed to read Nemotron 3.5 ASR encoder metadata: {error}"
            ))
        })?;
        let model_type = metadata.custom("model_type").ok_or_else(|| {
            TranscriptionError::invalid_model_with_details(
                "encoder metadata is missing model_type".to_string(),
            )
        })?;
        if model_type != MODEL_TYPE {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "expected model_type={MODEL_TYPE}, found {model_type}"
            )));
        }
        let normalization = metadata.custom("normalize_type").unwrap_or_default();
        if !normalization.is_empty() {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "unsupported Nemotron 3.5 ASR normalization {normalization:?}; expected no normalization"
            )));
        }

        let prompt_dictionary = metadata.custom("prompt_dictionary").ok_or_else(|| {
            TranscriptionError::invalid_model_with_details(
                "encoder metadata is missing prompt_dictionary".to_string(),
            )
        })?;
        let prompt_dictionary: HashMap<String, usize> = serde_json::from_str(&prompt_dictionary)
            .map_err(|error| {
                TranscriptionError::invalid_model_with_details(format!(
                    "invalid encoder prompt_dictionary: {error}"
                ))
            })?;
        if prompt_dictionary.get("en-US") != Some(&(EN_US_PROMPT_INDEX as usize))
            || prompt_dictionary.get("auto") != Some(&AUTO_PROMPT_INDEX)
            || metadata_usize(&metadata, "auto_prompt_id")? != AUTO_PROMPT_INDEX
        {
            return Err(TranscriptionError::invalid_model_with_details(
                "encoder prompt metadata does not define en-US=0 and auto=101".to_string(),
            ));
        }

        let decoder_vocab_size = metadata_usize(&metadata, "vocab_size")?;
        let config = Self {
            vocab_size: decoder_vocab_size.checked_add(1).ok_or_else(|| {
                TranscriptionError::invalid_model_with_details(
                    "Nemotron 3.5 ASR vocabulary size overflow".to_string(),
                )
            })?,
            feature_dim: metadata_usize(&metadata, "feat_dim")?,
            window_size: metadata_usize(&metadata, "window_size")?,
            chunk_shift: metadata_usize(&metadata, "chunk_shift")?,
            subsampling_factor: metadata_usize(&metadata, "subsampling_factor")?,
            encoder_dim: metadata_usize(&metadata, "cache_last_channel_dim3")?,
            cache_channel_layers: metadata_usize(&metadata, "cache_last_channel_dim1")?,
            cache_channel_time: metadata_usize(&metadata, "cache_last_channel_dim2")?,
            cache_time_width: metadata_usize(&metadata, "cache_last_time_dim3")?,
            predictor_layers: metadata_usize(&metadata, "pred_rnn_layers")?,
            predictor_hidden: metadata_usize(&metadata, "pred_hidden")?,
        };
        let chunk_size_ms = metadata_usize(&metadata, "chunk_size_ms")?;
        let cache_time_layers = metadata_usize(&metadata, "cache_last_time_dim1")?;
        let cache_time_dim = metadata_usize(&metadata, "cache_last_time_dim2")?;
        if chunk_size_ms != EXPECTED_CHUNK_SIZE_MS
            || cache_time_layers != config.cache_channel_layers
            || cache_time_dim != config.encoder_dim
        {
            return Err(TranscriptionError::invalid_model_with_details(
                "encoder metadata contains an unsupported chunk or cache layout".to_string(),
            ));
        }
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<(), TranscriptionError> {
        let actual = (
            self.vocab_size,
            self.feature_dim,
            self.window_size,
            self.chunk_shift,
            self.subsampling_factor,
            self.encoder_dim,
            self.cache_channel_layers,
            self.cache_channel_time,
            self.cache_time_width,
            self.predictor_layers,
            self.predictor_hidden,
        );
        let expected = (
            EXPECTED_VOCAB_SIZE,
            FEATURE_DIM,
            EXPECTED_WINDOW_SIZE,
            EXPECTED_CHUNK_SHIFT,
            EXPECTED_SUBSAMPLING_FACTOR,
            EXPECTED_ENCODER_DIM,
            EXPECTED_CACHE_CHANNEL_LAYERS,
            EXPECTED_CACHE_CHANNEL_TIME,
            EXPECTED_CACHE_TIME_WIDTH,
            EXPECTED_PREDICTOR_LAYERS,
            EXPECTED_PREDICTOR_HIDDEN,
        );
        if actual != expected {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "unsupported Nemotron 3.5 ASR metadata dimensions: {actual:?}"
            )));
        }
        Ok(())
    }
}

fn metadata_usize(
    metadata: &ort::session::ModelMetadata<'_>,
    key: &str,
) -> Result<usize, TranscriptionError> {
    let value = metadata.custom(key).ok_or_else(|| {
        TranscriptionError::invalid_model_with_details(format!("encoder metadata is missing {key}"))
    })?;
    value.parse::<usize>().map_err(|error| {
        TranscriptionError::invalid_model_with_details(format!(
            "invalid encoder metadata {key}={value:?}: {error}"
        ))
    })
}

fn verify_graph_topology(
    encoder: &Session,
    decoder: &Session,
    joiner: &Session,
    config: &NemotronConfig,
) -> Result<(), TranscriptionError> {
    verify_session_io(
        encoder,
        "encoder",
        &[
            "audio_signal",
            "length",
            "cache_last_channel",
            "cache_last_time",
            "cache_last_channel_len",
            "prompt_index",
        ],
        &[
            "outputs",
            "encoded_lengths",
            "cache_last_channel_next",
            "cache_last_time_next",
            "cache_last_channel_next_len",
        ],
    )?;
    verify_session_io(
        decoder,
        "decoder",
        &["targets", "target_length", "states.1", "onnx::Slice_3"],
        &["outputs", "prednet_lengths", "states", "162"],
    )?;
    verify_session_io(
        joiner,
        "joiner",
        &["encoder_outputs", "decoder_outputs"],
        &["outputs"],
    )?;

    verify_io_count(encoder, "encoder", 6, 5)?;
    verify_io_count(decoder, "decoder", 4, 4)?;
    verify_io_count(joiner, "joiner", 2, 1)?;

    verify_tensor(
        encoder.inputs()[0].dtype(),
        "encoder input 0",
        TensorElementType::Float32,
        3,
    )?;
    verify_tensor(
        encoder.inputs()[1].dtype(),
        "encoder input 1",
        TensorElementType::Int64,
        1,
    )?;
    verify_tensor(
        encoder.inputs()[2].dtype(),
        "encoder cache_last_channel input",
        TensorElementType::Float32,
        4,
    )?;
    verify_tensor(
        encoder.inputs()[3].dtype(),
        "encoder cache_last_time input",
        TensorElementType::Float32,
        4,
    )?;
    verify_tensor(
        encoder.inputs()[4].dtype(),
        "encoder cache_last_channel_len input",
        TensorElementType::Int64,
        1,
    )?;
    verify_tensor(
        encoder.inputs()[5].dtype(),
        "encoder prompt_index input",
        TensorElementType::Int64,
        1,
    )?;
    verify_tensor(
        encoder.outputs()[0].dtype(),
        "encoder output",
        TensorElementType::Float32,
        3,
    )?;
    verify_tensor(
        encoder.outputs()[1].dtype(),
        "encoder encoded_lengths output",
        TensorElementType::Int64,
        1,
    )?;
    for (index, output) in encoder.outputs()[2..4].iter().enumerate() {
        verify_tensor(
            output.dtype(),
            &format!("encoder cache output {index}"),
            TensorElementType::Float32,
            4,
        )?;
    }
    verify_tensor(
        encoder.outputs()[4].dtype(),
        "encoder cache length output",
        TensorElementType::Int64,
        1,
    )?;
    verify_tensor(
        decoder.inputs()[0].dtype(),
        "decoder input 0",
        TensorElementType::Int32,
        2,
    )?;
    verify_tensor(
        decoder.inputs()[1].dtype(),
        "decoder input 1",
        TensorElementType::Int32,
        1,
    )?;
    for (index, input) in decoder.inputs()[2..].iter().enumerate() {
        verify_tensor(
            input.dtype(),
            &format!("decoder state input {index}"),
            TensorElementType::Float32,
            3,
        )?;
        if let ValueType::Tensor { shape, .. } = input.dtype() {
            validate_static_dimension(shape, 0, config.predictor_layers, "decoder state layers")?;
            validate_static_dimension(shape, 2, config.predictor_hidden, "decoder state hidden")?;
        }
    }
    verify_tensor(
        decoder.outputs()[0].dtype(),
        "decoder output",
        TensorElementType::Float32,
        3,
    )?;
    verify_tensor(
        decoder.outputs()[1].dtype(),
        "decoder length output",
        TensorElementType::Int32,
        1,
    )?;
    for (index, output) in decoder.outputs()[2..].iter().enumerate() {
        verify_tensor(
            output.dtype(),
            &format!("decoder state output {index}"),
            TensorElementType::Float32,
            3,
        )?;
        if let ValueType::Tensor { shape, .. } = output.dtype() {
            validate_static_dimension(shape, 0, config.predictor_layers, "decoder state layers")?;
            validate_static_dimension(shape, 2, config.predictor_hidden, "decoder state hidden")?;
        }
    }
    verify_tensor(
        joiner.inputs()[0].dtype(),
        "joiner input 0",
        TensorElementType::Float32,
        3,
    )?;
    verify_tensor(
        joiner.inputs()[1].dtype(),
        "joiner input 1",
        TensorElementType::Float32,
        3,
    )?;
    verify_tensor(
        joiner.outputs()[0].dtype(),
        "joiner output",
        TensorElementType::Float32,
        4,
    )?;

    if let ValueType::Tensor { shape, .. } = encoder.inputs()[0].dtype() {
        validate_static_dimension(shape, 1, config.feature_dim, "encoder feature dimension")?;
    }
    if let ValueType::Tensor { shape, .. } = encoder.outputs()[0].dtype() {
        validate_static_dimension(shape, 1, config.encoder_dim, "encoder output dimension")?;
    }
    for (value_type, dimensions, label) in [
        (
            encoder.inputs()[2].dtype(),
            [
                config.cache_channel_layers,
                config.cache_channel_time,
                config.encoder_dim,
            ],
            "encoder channel cache",
        ),
        (
            encoder.inputs()[3].dtype(),
            [
                config.cache_channel_layers,
                config.encoder_dim,
                config.cache_time_width,
            ],
            "encoder time cache",
        ),
        (
            encoder.outputs()[2].dtype(),
            [
                config.cache_channel_layers,
                config.cache_channel_time,
                config.encoder_dim,
            ],
            "encoder next channel cache",
        ),
        (
            encoder.outputs()[3].dtype(),
            [
                config.cache_channel_layers,
                config.encoder_dim,
                config.cache_time_width,
            ],
            "encoder next time cache",
        ),
    ] {
        if let ValueType::Tensor { shape, .. } = value_type {
            for (offset, expected) in dimensions.into_iter().enumerate() {
                validate_static_dimension(shape, offset + 1, expected, label)?;
            }
        }
    }
    if let ValueType::Tensor { shape, .. } = joiner.inputs()[0].dtype() {
        validate_static_dimension(shape, 1, config.encoder_dim, "joiner encoder dimension")?;
    }
    if let ValueType::Tensor { shape, .. } = joiner.inputs()[1].dtype() {
        validate_static_dimension(
            shape,
            1,
            config.predictor_hidden,
            "joiner decoder dimension",
        )?;
    }
    if let ValueType::Tensor { shape, .. } = decoder.outputs()[0].dtype() {
        validate_static_dimension(
            shape,
            1,
            config.predictor_hidden,
            "decoder output dimension",
        )?;
    }
    if let ValueType::Tensor { shape, .. } = joiner.outputs()[0].dtype() {
        validate_static_dimension(shape, 3, config.vocab_size, "joiner vocabulary dimension")?;
    }
    Ok(())
}

fn verify_session_io(
    session: &Session,
    graph: &str,
    expected_inputs: &[&str],
    expected_outputs: &[&str],
) -> Result<(), TranscriptionError> {
    let actual_inputs: Vec<&str> = session.inputs().iter().map(|input| input.name()).collect();
    let actual_outputs: Vec<&str> = session
        .outputs()
        .iter()
        .map(|output| output.name())
        .collect();
    if actual_inputs != expected_inputs || actual_outputs != expected_outputs {
        return Err(TranscriptionError::invalid_model_with_details(format!(
            "{graph} graph I/O mismatch: inputs {actual_inputs:?}, outputs {actual_outputs:?}"
        )));
    }
    Ok(())
}

fn verify_io_count(
    session: &Session,
    graph: &str,
    input_count: usize,
    output_count: usize,
) -> Result<(), TranscriptionError> {
    if session.inputs().len() != input_count || session.outputs().len() != output_count {
        return Err(TranscriptionError::invalid_model_with_details(format!(
            "{graph} graph topology mismatch: expected {input_count} inputs/{output_count} outputs, found {}/{}",
            session.inputs().len(),
            session.outputs().len()
        )));
    }
    Ok(())
}

fn verify_tensor(
    value_type: &ValueType,
    name: &str,
    expected_element: TensorElementType,
    expected_rank: usize,
) -> Result<(), TranscriptionError> {
    let ValueType::Tensor { ty, shape, .. } = value_type else {
        return Err(TranscriptionError::invalid_model_with_details(format!(
            "{name} is not a tensor"
        )));
    };
    if *ty != expected_element || shape.len() != expected_rank {
        return Err(TranscriptionError::invalid_model_with_details(format!(
            "{name} mismatch: expected {expected_element:?} rank {expected_rank}, found {ty:?} {shape:?}"
        )));
    }
    Ok(())
}

fn validate_static_dimension(
    shape: &[i64],
    index: usize,
    expected: usize,
    name: &str,
) -> Result<(), TranscriptionError> {
    if let Some(&actual) = shape.get(index)
        && actual > 0
        && actual != expected as i64
    {
        return Err(TranscriptionError::invalid_model_with_details(format!(
            "{name} mismatch: expected {expected}, found {actual}"
        )));
    }
    Ok(())
}

struct NemotronTokenizer {
    pieces: Vec<String>,
}

impl NemotronTokenizer {
    fn load(path: &Path) -> Result<Self, TranscriptionError> {
        let text = fs::read_to_string(path).map_err(|error| {
            TranscriptionError::invalid_model_with_details(format!(
                "failed to read {}: {error}",
                path.display()
            ))
        })?;
        let mut pieces = Vec::new();
        for (line_number, line) in text.lines().enumerate() {
            let (piece, id) = line.rsplit_once(' ').ok_or_else(|| {
                TranscriptionError::invalid_model_with_details(format!(
                    "invalid tokens.txt line {}",
                    line_number + 1
                ))
            })?;
            let id = id.parse::<usize>().map_err(|error| {
                TranscriptionError::invalid_model_with_details(format!(
                    "invalid tokens.txt id on line {}: {error}",
                    line_number + 1
                ))
            })?;
            if id != pieces.len() || piece.is_empty() {
                return Err(TranscriptionError::invalid_model_with_details(format!(
                    "tokens.txt must contain contiguous non-empty pieces; line {} declares id {id}",
                    line_number + 1
                )));
            }
            pieces.push(piece.to_string());
        }
        Ok(Self { pieces })
    }

    fn validate(&self, vocab_size: usize) -> Result<(), TranscriptionError> {
        if self.pieces.len() != vocab_size
            || self.pieces.last().map(String::as_str) != Some("<blk>")
        {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "tokenizer mismatch: expected {vocab_size} pieces ending in <blk>, found {}",
                self.pieces.len()
            )));
        }
        Ok(())
    }

    fn decode(&self, token_ids: &[i32]) -> Result<String, TranscriptionError> {
        let mut text = String::new();
        for &id in token_ids {
            let piece = usize::try_from(id)
                .ok()
                .and_then(|id| self.pieces.get(id))
                .ok_or_else(|| {
                    TranscriptionError::transcription_failure(
                        "Nemotron tokenizer",
                        format!("token id {id} is outside the vocabulary"),
                    )
                })?;
            if is_language_tag(piece) {
                continue;
            }
            text.push_str(piece);
        }
        Ok(text.replace('▁', " ").trim().to_string())
    }
}

fn is_language_tag(piece: &str) -> bool {
    let bytes = piece.as_bytes();
    if bytes.len() < 4 || bytes[0] != b'<' || bytes[bytes.len() - 1] != b'>' {
        return false;
    }
    let body = &bytes[1..bytes.len() - 1];
    if (2..=3).contains(&body.len()) && body.iter().all(u8::is_ascii_lowercase) {
        return true;
    }
    body.len() == 5
        && body[..2].iter().all(u8::is_ascii_lowercase)
        && body[2] == b'-'
        && body[3..].iter().all(u8::is_ascii_uppercase)
}

#[derive(Clone)]
struct PredictorState {
    hidden: Vec<f32>,
    cell: Vec<f32>,
}

impl PredictorState {
    fn zeros(config: &NemotronConfig) -> Self {
        let length = config.predictor_layers * config.predictor_hidden;
        Self {
            hidden: vec![0.0; length],
            cell: vec![0.0; length],
        }
    }
}

struct DecoderStep {
    output: Vec<f32>,
    next_state: PredictorState,
}

struct EncoderState {
    channel: Vec<f32>,
    time: Vec<f32>,
    channel_len: i64,
}

impl EncoderState {
    fn zeros(config: &NemotronConfig) -> Self {
        Self {
            channel: vec![
                0.0;
                config.cache_channel_layers
                    * config.cache_channel_time
                    * config.encoder_dim
            ],
            time: vec![
                0.0;
                config.cache_channel_layers * config.encoder_dim * config.cache_time_width
            ],
            channel_len: 0,
        }
    }
}

struct LoadedNemotronModel {
    config: NemotronConfig,
    decoder: Session,
    encoder: Session,
    encoder_state: EncoderState,
    features: OnlineNemotronFeatures,
    joiner: Session,
    last_token: Option<i32>,
    predictor_state_before_last: PredictorState,
    processed_feature_frames: usize,
    sample_count: usize,
    tokenizer: NemotronTokenizer,
    tokens: Vec<i32>,
}

impl LoadedNemotronModel {
    fn load(path: &Path, gpu: GpuConfig) -> Result<Self, TranscriptionError> {
        let paths = resolve_model_paths(path)?;
        let encoder = build_session(&paths.encoder, gpu)?;
        let config = NemotronConfig::from_encoder(&encoder)?;
        let decoder = build_session(&paths.decoder, GpuConfig { use_gpu: false })?;
        let joiner = build_session(&paths.joiner, GpuConfig { use_gpu: false })?;
        verify_graph_topology(&encoder, &decoder, &joiner, &config)?;
        let tokenizer = NemotronTokenizer::load(&paths.tokens)?;
        tokenizer.validate(config.vocab_size)?;
        let predictor_state_before_last = PredictorState::zeros(&config);
        let encoder_state = EncoderState::zeros(&config);
        Ok(Self {
            config,
            decoder,
            encoder,
            encoder_state,
            features: OnlineNemotronFeatures::new(),
            joiner,
            last_token: None,
            predictor_state_before_last,
            processed_feature_frames: 0,
            sample_count: 0,
            tokenizer,
            tokens: Vec::new(),
        })
    }

    fn blank_id(&self) -> i32 {
        (self.config.vocab_size - 1) as i32
    }

    fn process_ready_chunks(&mut self, finalizing: bool) -> Result<(), TranscriptionError> {
        if finalizing {
            self.features.finish();
        }
        loop {
            let ready = self.features.len();
            let remaining = ready.saturating_sub(self.processed_feature_frames);
            let can_decode = if finalizing {
                remaining > 0
            } else {
                remaining >= self.config.window_size
            };
            if !can_decode {
                break;
            }

            let window = self
                .features
                .window(self.processed_feature_frames, self.config.window_size);
            let valid_frames = remaining.min(self.config.window_size);
            let encoder_frames = self.run_encoder_chunk(&window, valid_frames)?;
            self.decode_encoder_frames(&encoder_frames)?;
            self.processed_feature_frames += self.config.chunk_shift.min(remaining);
        }
        Ok(())
    }

    /// Run one encoder window. `valid_frames` is the number of real feature
    /// frames in the window; the finalize tail is shorter than the window and
    /// must be masked by the graph's `length` input so zero-padded frames are
    /// never decoded as audio.
    fn run_encoder_chunk(
        &mut self,
        window: &[f32],
        valid_frames: usize,
    ) -> Result<Vec<Vec<f32>>, TranscriptionError> {
        let time = self.config.window_size;
        let mut transposed = vec![0.0_f32; self.config.feature_dim * time];
        for frame in 0..time {
            for feature in 0..self.config.feature_dim {
                transposed[feature * time + frame] =
                    window[frame * self.config.feature_dim + feature];
            }
        }
        let features = value(
            Array3::from_shape_vec((1, self.config.feature_dim, time), transposed),
            "Nemotron encoder features",
        )?;
        let length = value(
            Ok(Array1::from_vec(vec![valid_frames as i64])),
            "Nemotron encoder length",
        )?;
        let channel_cache = value(
            Array4::from_shape_vec(
                (
                    1,
                    self.config.cache_channel_layers,
                    self.config.cache_channel_time,
                    self.config.encoder_dim,
                ),
                self.encoder_state.channel.clone(),
            ),
            "Nemotron encoder channel cache",
        )?;
        let time_cache = value(
            Array4::from_shape_vec(
                (
                    1,
                    self.config.cache_channel_layers,
                    self.config.encoder_dim,
                    self.config.cache_time_width,
                ),
                self.encoder_state.time.clone(),
            ),
            "Nemotron encoder time cache",
        )?;
        let channel_cache_len = value(
            Ok(Array1::from_vec(vec![self.encoder_state.channel_len])),
            "Nemotron encoder channel cache length",
        )?;
        let prompt_index = value(
            Ok(Array1::from_vec(vec![EN_US_PROMPT_INDEX])),
            "Nemotron encoder prompt index",
        )?;
        let outputs = self
            .encoder
            .run(ort::inputs![
                features,
                length,
                channel_cache,
                time_cache,
                channel_cache_len,
                prompt_index
            ])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Nemotron encoder", &error)
            })?;
        let (shape, encoded) = tensor_f32(output_at(&outputs, 0, "encoder output")?, "encoder")?;
        if shape.len() != 3
            || shape[0] != 1
            || shape[1] != self.config.encoder_dim as i64
            || shape[2] <= 0
        {
            return Err(graph_shape_error("encoder output", &shape));
        }
        let encoder_time = dimension(&shape, 2, "encoder output")?;
        let encoded_lengths = tensor_i64_exact(
            output_at(&outputs, 1, "encoder encoded lengths")?,
            &[1],
            "encoder encoded lengths",
        )?;
        let valid_encoder_frames = usize::try_from(encoded_lengths[0])
            .map_err(|_| graph_shape_error("encoder encoded lengths", &[encoded_lengths[0]]))?;
        // The graph is the authority on how many output frames a chunk yields:
        // finalize tails inside the encoder lookahead (8-9 feature frames)
        // legitimately encode to zero frames. Only an impossible overrun is a
        // graph-contract violation.
        let max_encoder_frames =
            encoder_time.min(valid_frames.div_ceil(self.config.subsampling_factor));
        if valid_encoder_frames > max_encoder_frames {
            return Err(graph_shape_error(
                "encoder encoded lengths",
                &[encoded_lengths[0]],
            ));
        }

        let next_channel = tensor_f32_exact(
            output_at(&outputs, 2, "encoder next channel cache")?,
            &[
                1,
                self.config.cache_channel_layers,
                self.config.cache_channel_time,
                self.config.encoder_dim,
            ],
            "encoder next channel cache",
        )?;
        let next_time = tensor_f32_exact(
            output_at(&outputs, 3, "encoder next time cache")?,
            &[
                1,
                self.config.cache_channel_layers,
                self.config.encoder_dim,
                self.config.cache_time_width,
            ],
            "encoder next time cache",
        )?;
        let next_channel_len = tensor_i64_exact(
            output_at(&outputs, 4, "encoder next channel cache length")?,
            &[1],
            "encoder next channel cache length",
        )?[0];
        if !(0..=self.config.cache_channel_time as i64).contains(&next_channel_len) {
            return Err(graph_shape_error(
                "encoder next channel cache length",
                &[next_channel_len],
            ));
        }

        let mut frames = Vec::with_capacity(valid_encoder_frames);
        for time_index in 0..valid_encoder_frames {
            let mut frame = Vec::with_capacity(self.config.encoder_dim);
            for column in 0..self.config.encoder_dim {
                frame.push(encoded[column * encoder_time + time_index]);
            }
            frames.push(frame);
        }
        self.encoder_state = EncoderState {
            channel: next_channel,
            time: next_time,
            channel_len: next_channel_len,
        };
        Ok(frames)
    }

    fn decode_encoder_frames(
        &mut self,
        encoder_frames: &[Vec<f32>],
    ) -> Result<(), TranscriptionError> {
        let decoder_input = self.last_token.unwrap_or_else(|| self.blank_id());
        let mut decoder_step =
            self.run_decoder(decoder_input, &self.predictor_state_before_last.clone())?;

        for encoder_frame in encoder_frames {
            for _ in 0..MAX_SYMBOLS_PER_FRAME {
                let next_token = self.run_joiner(encoder_frame, &decoder_step)?;
                if next_token == self.blank_id() {
                    break;
                }
                if next_token < 0 || next_token as usize >= self.config.vocab_size - 1 {
                    return Err(TranscriptionError::transcription_failure(
                        "Nemotron joiner",
                        format!("emitted invalid token id {next_token}"),
                    ));
                }

                self.tokens.push(next_token);
                self.last_token = Some(next_token);
                self.predictor_state_before_last = decoder_step.next_state.clone();
                decoder_step =
                    self.run_decoder(next_token, &self.predictor_state_before_last.clone())?;
            }
        }
        Ok(())
    }

    fn run_decoder(
        &mut self,
        token: i32,
        state: &PredictorState,
    ) -> Result<DecoderStep, TranscriptionError> {
        let targets = value(
            Array2::from_shape_vec((1, 1), vec![token]),
            "Nemotron decoder target",
        )?;
        let target_length = value(
            Ok(Array1::from_vec(vec![1_i32])),
            "Nemotron decoder target length",
        )?;
        let state_shape = (
            self.config.predictor_layers,
            1,
            self.config.predictor_hidden,
        );
        let hidden = value(
            Array3::from_shape_vec(state_shape, state.hidden.clone()),
            "Nemotron decoder hidden state",
        )?;
        let cell = value(
            Array3::from_shape_vec(state_shape, state.cell.clone()),
            "Nemotron decoder cell state",
        )?;
        let outputs = self
            .decoder
            .run(ort::inputs![targets, target_length, hidden, cell])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Nemotron decoder", &error)
            })?;
        let output = tensor_f32_exact(
            output_at(&outputs, 0, "decoder output")?,
            &[1, self.config.predictor_hidden, 1],
            "decoder output",
        )?;
        let hidden = tensor_f32_exact(
            output_at(&outputs, 2, "decoder hidden state")?,
            &[
                self.config.predictor_layers,
                1,
                self.config.predictor_hidden,
            ],
            "decoder hidden state",
        )?;
        let cell = tensor_f32_exact(
            output_at(&outputs, 3, "decoder cell state")?,
            &[
                self.config.predictor_layers,
                1,
                self.config.predictor_hidden,
            ],
            "decoder cell state",
        )?;
        Ok(DecoderStep {
            output,
            next_state: PredictorState { hidden, cell },
        })
    }

    fn run_joiner(
        &mut self,
        encoder_frame: &[f32],
        decoder_step: &DecoderStep,
    ) -> Result<i32, TranscriptionError> {
        let encoder = value(
            Array3::from_shape_vec((1, encoder_frame.len(), 1), encoder_frame.to_vec()),
            "Nemotron joiner encoder input",
        )?;
        let decoder = value(
            Array3::from_shape_vec(
                (1, self.config.predictor_hidden, 1),
                decoder_step.output.clone(),
            ),
            "Nemotron joiner decoder input",
        )?;
        let outputs = self
            .joiner
            .run(ort::inputs![encoder, decoder])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Nemotron joiner", &error)
            })?;
        let logits = tensor_f32_exact(
            output_at(&outputs, 0, "joiner output")?,
            &[1, 1, 1, self.config.vocab_size],
            "joiner output",
        )?;
        logits
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.total_cmp(right))
            .map(|(index, _)| index as i32)
            .ok_or_else(|| {
                TranscriptionError::transcription_failure("Nemotron joiner", "logits were empty")
            })
    }

    fn output(&self) -> Result<EngineTranscriptOutput, TranscriptionError> {
        let text = self.tokenizer.decode(&self.tokens)?;
        let segments = if text.is_empty() {
            Vec::new()
        } else {
            vec![TranscriptSegment {
                end_ms: (self.sample_count as u64 * 1_000) / SAMPLE_RATE as u64,
                speaker: None,
                start_ms: 0,
                text,
                timestamp_granularity: TimestampGranularity::Utterance,
                timestamp_source: TimestampSource::Vad,
                words: Vec::new(),
            }]
        };
        Ok(EngineTranscriptOutput {
            segments,
            diagnostics: Vec::new(),
        })
    }
}

impl StreamingModel for LoadedNemotronModel {
    fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError> {
        self.sample_count = self.sample_count.saturating_add(samples.len());
        self.features.accept(samples);
        Ok(())
    }

    fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
        let result = self
            .process_ready_chunks(false)
            .and_then(|()| self.output());
        if result.is_err() {
            self.reset_utterance();
        }
        result
    }

    fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
        let result = self.process_ready_chunks(true).and_then(|()| self.output());
        self.reset_utterance();
        result
    }

    fn reset_utterance(&mut self) {
        self.features.reset();
        self.encoder_state = EncoderState::zeros(&self.config);
        self.last_token = None;
        self.predictor_state_before_last = PredictorState::zeros(&self.config);
        self.processed_feature_frames = 0;
        self.sample_count = 0;
        self.tokens.clear();
    }
}

struct OnlineNemotronFeatures {
    audio: Vec<f32>,
    features: Vec<[f32; FEATURE_DIM]>,
    filterbank: Vec<[f32; FFT_BINS]>,
    fft_planner: RealFftPlanner<f32>,
    finished: bool,
    window: [f32; FRAME_LENGTH_SAMPLES],
}

impl OnlineNemotronFeatures {
    fn new() -> Self {
        Self {
            audio: Vec::new(),
            features: Vec::new(),
            filterbank: build_librosa_filterbank(),
            fft_planner: RealFftPlanner::new(),
            finished: false,
            window: build_symmetric_hann_window(),
        }
    }

    fn accept(&mut self, samples: &[i16]) {
        debug_assert!(!self.finished);
        self.audio
            .extend(samples.iter().map(|&sample| sample as f32 / 32768.0));
        self.compute_available(false);
    }

    fn finish(&mut self) {
        if !self.finished {
            self.finished = true;
            self.compute_available(true);
        }
    }

    fn reset(&mut self) {
        self.audio.clear();
        self.features.clear();
        self.finished = false;
    }

    fn len(&self) -> usize {
        self.features.len()
    }

    fn compute_available(&mut self, flush: bool) {
        if self.audio.is_empty() {
            return;
        }
        let target = frame_count(self.audio.len(), flush);
        while self.features.len() < target {
            let frame = self.compute_frame(self.features.len());
            self.features.push(frame);
        }
    }

    fn compute_frame(&mut self, frame_index: usize) -> [f32; FEATURE_DIM] {
        let start = frame_index as isize * FRAME_SHIFT_SAMPLES as isize
            - (FRAME_LENGTH_SAMPLES / 2) as isize;
        let mut fft_input = vec![0.0_f32; FFT_SIZE];
        for (offset, sample) in fft_input
            [STFT_WINDOW_OFFSET..STFT_WINDOW_OFFSET + FRAME_LENGTH_SAMPLES]
            .iter_mut()
            .enumerate()
        {
            *sample =
                preemphasized_sample(&self.audio, start + offset as isize) * self.window[offset];
        }

        let fft = self.fft_planner.plan_fft_forward(FFT_SIZE);
        let mut fft_output = fft.make_output_vec();
        fft.process(&mut fft_input, &mut fft_output)
            .expect("Nemotron FFT buffers match the planned size");
        let mut power = [0.0_f32; FFT_BINS];
        for (index, value) in fft_output.iter().enumerate() {
            power[index] = value.re * value.re + value.im * value.im;
        }

        let mut result = [0.0_f32; FEATURE_DIM];
        for (mel_index, weights) in self.filterbank.iter().enumerate() {
            let energy = weights
                .iter()
                .zip(power)
                .map(|(weight, value)| weight * value)
                .sum::<f32>();
            result[mel_index] = (energy + LOG_ZERO_GUARD).ln();
        }
        result
    }

    fn window(&self, start: usize, frame_count: usize) -> Vec<f32> {
        let mut window = vec![0.0_f32; frame_count * FEATURE_DIM];
        for target_frame in 0..frame_count {
            if let Some(source) = self.features.get(start + target_frame) {
                window[target_frame * FEATURE_DIM..(target_frame + 1) * FEATURE_DIM]
                    .copy_from_slice(source);
            }
        }
        window
    }
}

fn frame_count(sample_count: usize, flush: bool) -> usize {
    if flush {
        return sample_count / FRAME_SHIFT_SAMPLES;
    }
    sample_count
        .saturating_sub(FRAME_LENGTH_SAMPLES / 2)
        .div_ceil(FRAME_SHIFT_SAMPLES)
}

fn preemphasized_sample(audio: &[f32], index: isize) -> f32 {
    let Ok(index) = usize::try_from(index) else {
        return 0.0;
    };
    let Some(&sample) = audio.get(index) else {
        return 0.0;
    };
    if index == 0 {
        sample
    } else {
        sample - PREEMPHASIS_COEFFICIENT * audio[index - 1]
    }
}

fn build_symmetric_hann_window() -> [f32; FRAME_LENGTH_SAMPLES] {
    std::array::from_fn(|index| {
        let phase = 2.0 * std::f32::consts::PI * index as f32 / (FRAME_LENGTH_SAMPLES - 1) as f32;
        0.5 - 0.5 * phase.cos()
    })
}

fn build_librosa_filterbank() -> Vec<[f32; FFT_BINS]> {
    let mel_min = hz_to_slaney_mel(0.0);
    let mel_max = hz_to_slaney_mel(SAMPLE_RATE as f32 / 2.0);
    let mel_step = (mel_max - mel_min) / (FEATURE_DIM + 1) as f32;
    (0..FEATURE_DIM)
        .map(|bin| {
            let left = slaney_mel_to_hz(mel_min + bin as f32 * mel_step);
            let center = slaney_mel_to_hz(mel_min + (bin + 1) as f32 * mel_step);
            let right = slaney_mel_to_hz(mel_min + (bin + 2) as f32 * mel_step);
            let normalization = 2.0 / (right - left);
            std::array::from_fn(|fft_bin| {
                let hz = SAMPLE_RATE as f32 / FFT_SIZE as f32 * fft_bin as f32;
                if hz > left && hz <= center {
                    (hz - left) / (center - left) * normalization
                } else if hz > center && hz < right {
                    (right - hz) / (right - center) * normalization
                } else {
                    0.0
                }
            })
        })
        .collect()
}

fn hz_to_slaney_mel(hz: f32) -> f32 {
    if hz <= 1_000.0 {
        hz * 3.0 / 200.0
    } else {
        15.0 + 14.545_078 * (hz / 1_000.0).ln()
    }
}

fn slaney_mel_to_hz(mel: f32) -> f32 {
    if mel <= 15.0 {
        200.0 / 3.0 * mel
    } else {
        1_000.0 * ((mel - 15.0) * 0.068_751_775).exp()
    }
}

fn value<T, D>(
    result: Result<ndarray::Array<T, D>, ndarray::ShapeError>,
    context: &str,
) -> Result<Tensor<T>, TranscriptionError>
where
    T: PrimitiveTensorElementType + Clone + std::fmt::Debug + 'static,
    D: ndarray::Dimension + 'static,
{
    let array =
        result.map_err(|error| TranscriptionError::transcription_failure(context, &error))?;
    Value::from_array(array)
        .map_err(|error| TranscriptionError::transcription_failure(context, &error))
}

fn output_at<'a>(
    outputs: &'a ort::session::SessionOutputs<'_>,
    index: usize,
    name: &str,
) -> Result<&'a DynValue, TranscriptionError> {
    if index >= outputs.len() {
        return Err(TranscriptionError::transcription_failure(
            "Nemotron graph output",
            format!("missing {name} at index {index}"),
        ));
    }
    Ok(&outputs[index])
}

fn tensor_f32(value: &DynValue, name: &str) -> Result<(Vec<i64>, Vec<f32>), TranscriptionError> {
    let (shape, data) = value
        .try_extract_tensor::<f32>()
        .map_err(|error| TranscriptionError::transcription_failure(name, &error))?;
    Ok((shape.to_vec(), data.to_vec()))
}

fn tensor_f32_exact(
    value: &DynValue,
    expected_shape: &[usize],
    name: &str,
) -> Result<Vec<f32>, TranscriptionError> {
    let (shape, data) = tensor_f32(value, name)?;
    if !shape_matches(&shape, expected_shape) {
        return Err(graph_shape_error(name, &shape));
    }
    Ok(data)
}

fn tensor_i64_exact(
    value: &DynValue,
    expected_shape: &[usize],
    name: &str,
) -> Result<Vec<i64>, TranscriptionError> {
    let (shape, data) = value
        .try_extract_tensor::<i64>()
        .map_err(|error| TranscriptionError::transcription_failure(name, &error))?;
    if !shape_matches(shape, expected_shape) {
        return Err(graph_shape_error(name, shape));
    }
    Ok(data.to_vec())
}

fn shape_matches(actual: &[i64], expected: &[usize]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(&actual, &expected)| actual == expected as i64)
}

fn dimension(shape: &[i64], index: usize, name: &str) -> Result<usize, TranscriptionError> {
    shape
        .get(index)
        .and_then(|value| usize::try_from(*value).ok())
        .ok_or_else(|| graph_shape_error(name, shape))
}

fn graph_shape_error(name: &str, shape: &[i64]) -> TranscriptionError {
    TranscriptionError::transcription_failure(
        "Nemotron graph shape",
        format!("unexpected {name} shape {shape:?}"),
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn non_snipping_frame_count_waits_for_complete_frames_until_flush() {
        assert_eq!(frame_count(0, false), 0);
        assert_eq!(frame_count(320, false), 1);
        assert_eq!(frame_count(320, true), 2);
        assert_eq!(frame_count(16_000, false), 99);
        assert_eq!(frame_count(16_000, true), 100);
    }

    #[test]
    fn preemphasis_preserves_first_sample_and_zero_pads_stft_edges() {
        let audio = [0.5, 0.25];
        assert_eq!(preemphasized_sample(&audio, -1), 0.0);
        assert_eq!(preemphasized_sample(&audio, 0), 0.5);
        assert_eq!(preemphasized_sample(&audio, 1), 0.25 - 0.97 * 0.5);
        assert_eq!(preemphasized_sample(&audio, 2), 0.0);
    }

    #[test]
    fn symmetric_hann_has_zero_endpoints() {
        let window = build_symmetric_hann_window();
        assert_eq!(window[0], 0.0);
        assert!(window[FRAME_LENGTH_SAMPLES / 2] > 0.999);
        assert!(window[FRAME_LENGTH_SAMPLES - 1].abs() < 1e-6);
    }

    #[test]
    fn tokenizer_requires_contiguous_ids_and_blank_last() {
        let tokenizer = NemotronTokenizer {
            pieces: vec![
                "▁hello".to_string(),
                "<en-US>".to_string(),
                "▁world".to_string(),
                "<blk>".to_string(),
            ],
        };
        tokenizer.validate(4).unwrap();
        assert_eq!(tokenizer.decode(&[0, 1, 2]).unwrap(), "hello world");
        assert!(tokenizer.validate(3).is_err());
    }

    #[test]
    fn feature_windows_zero_pad_missing_tail_without_normalization() {
        let mut extractor = OnlineNemotronFeatures::new();
        extractor.accept(&vec![0_i16; 8_000]);
        let window = extractor.window(40, EXPECTED_WINDOW_SIZE);
        assert_eq!(window.len(), EXPECTED_WINDOW_SIZE * FEATURE_DIM);
        assert!(window.iter().all(|value| value.is_finite()));
        assert!(window[10 * FEATURE_DIM..].iter().all(|&value| value == 0.0));
    }

    #[test]
    fn frontend_matches_pinned_nemo_oracle() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let golden: serde_json::Value =
            serde_json::from_slice(&fs::read(fixtures.join("nemotron/golden-560ms.json")).unwrap())
                .unwrap();
        let mut reader =
            hound::WavReader::open(fixtures.join("audio/7021-79740-0000.wav")).unwrap();
        let samples: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();
        let mut extractor = OnlineNemotronFeatures::new();
        extractor.accept(&samples);
        extractor.finish();

        let frontend = &golden["frontend"];
        assert_eq!(
            extractor.len(),
            frontend["shape"][1].as_u64().unwrap() as usize
        );
        let bins: Vec<usize> = frontend["featureBins"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_u64().unwrap() as usize)
            .collect();
        let tolerance = frontend["maxAbsError"].as_f64().unwrap() as f32;
        for (frame, expected) in frontend["selectedFrames"].as_object().unwrap() {
            let frame = frame.parse::<usize>().unwrap();
            for (&bin, expected) in bins.iter().zip(expected.as_array().unwrap()) {
                let actual = extractor.features[frame][bin];
                let expected = expected.as_f64().unwrap() as f32;
                assert!(
                    (actual - expected).abs() <= tolerance,
                    "frame {frame}, bin {bin}: expected {expected}, found {actual}"
                );
            }
        }
    }
}
