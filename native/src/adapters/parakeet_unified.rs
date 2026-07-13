//! No-Python Parakeet Unified buffered RNNT adapter.
//!
//! The graph contract and inference behavior follow the Apache-2.0
//! sherpa-onnx v1.13.2 Parakeet Unified implementation and its pinned
//! kaldi-native-fbank v1.22.3 frontend. This is a native Rust implementation
//! over this project's existing ONNX Runtime, not a sherpa-onnx binding.

use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use ndarray::{Array, Array1, Array2, Array3, IxDyn};
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
const FEATURE_DIM: usize = 128;
const PREEMPHASIS_COEFFICIENT: f32 = 0.97;
const NORMALIZATION_EPSILON: f32 = 1e-5;
const MAX_SYMBOLS_PER_FRAME: usize = 10;
/// The worker asks for partials every 500 ms, which normally makes three
/// 160 ms center windows ready together. Batch a small bounded number of
/// independent encoder windows to amortize ORT dispatch without allowing a
/// one-shot final to allocate an utterance-sized encoder batch.
const MAX_ENCODER_BATCH: usize = 4;

const ENCODER_FILENAME: &str = "encoder.int8.onnx";
const DECODER_FILENAME: &str = "decoder.int8.onnx";
const JOINER_FILENAME: &str = "joiner.int8.onnx";
const TOKENS_FILENAME: &str = "tokens.txt";
const STREAMING_MODEL_TYPE: &str = "nemo_parakeet_unified_streaming";

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
pub struct ParakeetUnifiedAdapter;

impl ModelFamilyAdapter for ParakeetUnifiedAdapter {
    fn runtime_id(&self) -> RuntimeId {
        RuntimeId::OnnxRuntime
    }

    fn family_id(&self) -> ModelFamilyId {
        ModelFamilyId::ParakeetUnified
    }

    fn capabilities(&self) -> &ModelFamilyCapabilities {
        &CAPABILITIES
    }

    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError> {
        let paths = resolve_model_paths(path)?;
        let encoder = build_session(&paths.encoder, GpuConfig { use_gpu: false })
            .map_err(invalid_session("encoder"))?;
        let config = ParakeetConfig::from_encoder(&encoder)?;
        let decoder = build_session(&paths.decoder, GpuConfig { use_gpu: false })
            .map_err(invalid_session("decoder"))?;
        let joiner = build_session(&paths.joiner, GpuConfig { use_gpu: false })
            .map_err(invalid_session("joiner"))?;
        verify_graph_topology(&encoder, &decoder, &joiner, &config)?;
        let tokenizer = ParakeetTokenizer::load(&paths.tokens)?;
        tokenizer.validate(config.vocab_size)?;
        Ok(())
    }

    fn load(
        &self,
        _path: &Path,
        _gpu: GpuConfig,
    ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
        Err(TranscriptionError::unsupported_engine(
            "Parakeet Unified requires the streaming session path".to_string(),
        ))
    }

    fn load_streaming(
        &self,
        path: &Path,
        gpu: GpuConfig,
    ) -> Result<Box<dyn StreamingModel>, TranscriptionError> {
        Ok(Box::new(LoadedParakeetModel::load(path, gpu)?))
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
            "Parakeet Unified external models must be selected via {ENCODER_FILENAME}; received {}",
            path.display()
        )));
    }

    let directory = path.parent().ok_or_else(|| {
        TranscriptionError::invalid_model_with_details(
            "cannot determine the Parakeet Unified model directory".to_string(),
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
                "required Parakeet Unified asset missing: {}",
                required.display()
            ))
        })?;
    }
    Ok(paths)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParakeetConfig {
    vocab_size: usize,
    feature_dim: usize,
    subsampling_factor: usize,
    left_feature_frames: usize,
    chunk_feature_frames: usize,
    right_feature_frames: usize,
    left_encoder_frames: usize,
    chunk_encoder_frames: usize,
    right_encoder_frames: usize,
    predictor_layers: usize,
    predictor_hidden: usize,
}

impl ParakeetConfig {
    fn from_encoder(encoder: &Session) -> Result<Self, TranscriptionError> {
        let metadata = encoder.metadata().map_err(|error| {
            TranscriptionError::invalid_model_with_details(format!(
                "failed to read Parakeet Unified encoder metadata: {error}"
            ))
        })?;
        let model_type = metadata.custom("streaming_model_type").ok_or_else(|| {
            TranscriptionError::invalid_model_with_details(
                "encoder metadata is missing streaming_model_type".to_string(),
            )
        })?;
        if model_type != STREAMING_MODEL_TYPE {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "expected streaming_model_type={STREAMING_MODEL_TYPE}, found {model_type}"
            )));
        }
        let normalization = metadata.custom("normalize_type").unwrap_or_default();
        if normalization != "per_feature" {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "unsupported Parakeet Unified normalization {normalization:?}; expected per_feature"
            )));
        }

        let decoder_vocab_size = metadata_usize(&metadata, "vocab_size")?;
        let config = Self {
            vocab_size: decoder_vocab_size.checked_add(1).ok_or_else(|| {
                TranscriptionError::invalid_model_with_details(
                    "Parakeet Unified vocabulary size overflow".to_string(),
                )
            })?,
            feature_dim: metadata_usize(&metadata, "feat_dim")?,
            subsampling_factor: metadata_usize(&metadata, "subsampling_factor")?,
            left_feature_frames: metadata_usize(&metadata, "left_feature_frames")?,
            chunk_feature_frames: metadata_usize(&metadata, "chunk_feature_frames")?,
            right_feature_frames: metadata_usize(&metadata, "right_feature_frames")?,
            left_encoder_frames: metadata_usize(&metadata, "left_encoder_frames")?,
            chunk_encoder_frames: metadata_usize(&metadata, "chunk_encoder_frames")?,
            right_encoder_frames: metadata_usize(&metadata, "right_encoder_frames")?,
            predictor_layers: metadata_usize(&metadata, "pred_rnn_layers")?,
            predictor_hidden: metadata_usize(&metadata, "pred_hidden")?,
        };
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<(), TranscriptionError> {
        if self.feature_dim != FEATURE_DIM {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "unsupported Parakeet feature dimension {}; expected {FEATURE_DIM}",
                self.feature_dim
            )));
        }
        if self.subsampling_factor == 0
            || self.chunk_feature_frames == 0
            || self.chunk_encoder_frames == 0
            || self.predictor_layers == 0
            || self.predictor_hidden == 0
            || self.vocab_size < 2
        {
            return Err(TranscriptionError::invalid_model_with_details(
                "Parakeet Unified metadata contains a zero or invalid dimension".to_string(),
            ));
        }
        if self.left_feature_frames / self.subsampling_factor != self.left_encoder_frames
            || self.chunk_feature_frames / self.subsampling_factor != self.chunk_encoder_frames
            || self.right_feature_frames / self.subsampling_factor != self.right_encoder_frames
        {
            return Err(TranscriptionError::invalid_model_with_details(
                "Parakeet Unified feature and encoder context metadata disagree".to_string(),
            ));
        }
        if self.total_feature_frames() > 4_096
            || self.predictor_layers > 16
            || self.predictor_hidden > 8_192
            || self.vocab_size > 100_000
        {
            return Err(TranscriptionError::invalid_model_with_details(
                "Parakeet Unified metadata exceeds supported safety bounds".to_string(),
            ));
        }
        Ok(())
    }

    fn total_feature_frames(&self) -> usize {
        self.left_feature_frames + self.chunk_feature_frames + self.right_feature_frames
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
    config: &ParakeetConfig,
) -> Result<(), TranscriptionError> {
    verify_io_count(encoder, "encoder", 2, 2)?;
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

struct ParakeetTokenizer {
    pieces: Vec<String>,
}

impl ParakeetTokenizer {
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
                        "Parakeet tokenizer",
                        format!("token id {id} is outside the vocabulary"),
                    )
                })?;
            text.push_str(piece);
        }
        Ok(text.replace('▁', " ").trim().to_string())
    }
}

#[derive(Clone)]
struct PredictorState {
    hidden: Vec<f32>,
    cell: Vec<f32>,
}

impl PredictorState {
    fn zeros(config: &ParakeetConfig) -> Self {
        let length = config.predictor_layers * config.predictor_hidden;
        Self {
            hidden: vec![0.0; length],
            cell: vec![0.0; length],
        }
    }
}

struct DecoderStep {
    output: Vec<f32>,
    output_shape: Vec<usize>,
    next_state: PredictorState,
}

struct LoadedParakeetModel {
    config: ParakeetConfig,
    decoder: Session,
    encoder: Session,
    features: OnlineParakeetFeatures,
    joiner: Session,
    last_token: Option<i32>,
    predictor_state_before_last: PredictorState,
    processed_feature_frames: usize,
    sample_count: usize,
    tokenizer: ParakeetTokenizer,
    tokens: Vec<i32>,
}

impl LoadedParakeetModel {
    fn load(path: &Path, gpu: GpuConfig) -> Result<Self, TranscriptionError> {
        let paths = resolve_model_paths(path)?;
        let encoder = build_session(&paths.encoder, gpu)?;
        let config = ParakeetConfig::from_encoder(&encoder)?;
        let decoder = build_session(&paths.decoder, GpuConfig { use_gpu: false })?;
        let joiner = build_session(&paths.joiner, GpuConfig { use_gpu: false })?;
        verify_graph_topology(&encoder, &decoder, &joiner, &config)?;
        let tokenizer = ParakeetTokenizer::load(&paths.tokens)?;
        tokenizer.validate(config.vocab_size)?;
        let predictor_state_before_last = PredictorState::zeros(&config);
        Ok(Self {
            config,
            decoder,
            encoder,
            features: OnlineParakeetFeatures::new(),
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
            let mut consumed_features = 0_usize;
            let mut valid_encoder_counts = Vec::new();
            let mut windows = Vec::new();
            while windows.len() < MAX_ENCODER_BATCH {
                let processed = self.processed_feature_frames + consumed_features;
                let remaining = ready.saturating_sub(processed);
                let can_decode = if finalizing {
                    remaining > 0
                } else {
                    remaining >= self.config.chunk_feature_frames + self.config.right_feature_frames
                };
                if !can_decode {
                    break;
                }

                let valid_center = remaining.min(self.config.chunk_feature_frames);
                windows.push(self.features.normalized_window(
                    processed,
                    self.config.left_feature_frames,
                    self.config.chunk_feature_frames,
                    self.config.right_feature_frames,
                ));
                valid_encoder_counts.push(
                    valid_center
                        .div_ceil(self.config.subsampling_factor)
                        .min(self.config.chunk_encoder_frames),
                );
                consumed_features += valid_center;
            }
            if windows.is_empty() {
                break;
            }

            let encoder_batches = self.run_encoder_batch(&windows, &valid_encoder_counts)?;
            for encoder_frames in encoder_batches {
                self.decode_encoder_frames(&encoder_frames)?;
            }
            self.processed_feature_frames += consumed_features;
        }
        Ok(())
    }

    fn run_encoder_batch(
        &mut self,
        normalized_windows: &[Vec<f32>],
        valid_encoder_counts: &[usize],
    ) -> Result<Vec<Vec<Vec<f32>>>, TranscriptionError> {
        debug_assert_eq!(normalized_windows.len(), valid_encoder_counts.len());
        let batch = normalized_windows.len();
        let time = self.config.total_feature_frames();
        let input_batch_stride = self.config.feature_dim * time;
        let mut transposed = vec![0.0_f32; batch * input_batch_stride];
        for (batch_index, normalized_window) in normalized_windows.iter().enumerate() {
            for frame in 0..time {
                for feature in 0..self.config.feature_dim {
                    transposed[batch_index * input_batch_stride + feature * time + frame] =
                        normalized_window[frame * self.config.feature_dim + feature];
                }
            }
        }
        let features = value(
            Array3::from_shape_vec((batch, self.config.feature_dim, time), transposed),
            "Parakeet encoder features",
        )?;
        let length = value(
            Ok(Array1::from_vec(vec![time as i64; batch])),
            "Parakeet encoder length",
        )?;
        let outputs = self
            .encoder
            .run(ort::inputs![features, length])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Parakeet encoder", &error)
            })?;
        let (shape, encoded) = tensor_f32(output_at(&outputs, 0, "encoder output")?, "encoder")?;
        if shape.len() != 3 || shape[0] != batch as i64 || shape[1] <= 0 || shape[2] <= 0 {
            return Err(graph_shape_error("encoder output", &shape));
        }
        let encoder_dim = dimension(&shape, 1, "encoder output")?;
        let encoder_time = dimension(&shape, 2, "encoder output")?;
        let start = self.config.left_encoder_frames;
        let output_batch_stride = encoder_dim * encoder_time;
        let mut batches = Vec::with_capacity(batch);
        for (batch_index, &valid_encoder_frames) in valid_encoder_counts.iter().enumerate() {
            let end = start.saturating_add(valid_encoder_frames);
            if valid_encoder_frames == 0 || end > encoder_time {
                return Err(graph_shape_error("encoder center slice", &shape));
            }
            let mut frames = Vec::with_capacity(valid_encoder_frames);
            for time_index in start..end {
                let mut frame = Vec::with_capacity(encoder_dim);
                for column in 0..encoder_dim {
                    frame.push(
                        encoded[batch_index * output_batch_stride
                            + column * encoder_time
                            + time_index],
                    );
                }
                frames.push(frame);
            }
            batches.push(frames);
        }
        Ok(batches)
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
                        "Parakeet joiner",
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
            "Parakeet decoder target",
        )?;
        let target_length = value(
            Ok(Array1::from_vec(vec![1_i32])),
            "Parakeet decoder target length",
        )?;
        let state_shape = (
            self.config.predictor_layers,
            1,
            self.config.predictor_hidden,
        );
        let hidden = value(
            Array3::from_shape_vec(state_shape, state.hidden.clone()),
            "Parakeet decoder hidden state",
        )?;
        let cell = value(
            Array3::from_shape_vec(state_shape, state.cell.clone()),
            "Parakeet decoder cell state",
        )?;
        let outputs = self
            .decoder
            .run(ort::inputs![targets, target_length, hidden, cell])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Parakeet decoder", &error)
            })?;
        let (output_shape, output) =
            tensor_f32(output_at(&outputs, 0, "decoder output")?, "decoder output")?;
        if output_shape.len() != 3 {
            return Err(graph_shape_error("decoder output", &output_shape));
        }
        let hidden = tensor_f32_data(
            output_at(&outputs, 2, "decoder hidden state")?,
            state.hidden.len(),
            "decoder hidden state",
        )?;
        let cell = tensor_f32_data(
            output_at(&outputs, 3, "decoder cell state")?,
            state.cell.len(),
            "decoder cell state",
        )?;
        Ok(DecoderStep {
            output,
            output_shape: output_shape
                .iter()
                .map(|&value| usize::try_from(value).unwrap_or(0))
                .collect(),
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
            "Parakeet joiner encoder input",
        )?;
        let decoder = dynamic_value(
            &decoder_step.output_shape,
            decoder_step.output.clone(),
            "Parakeet joiner decoder input",
        )?;
        let outputs = self
            .joiner
            .run(ort::inputs![encoder, decoder])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Parakeet joiner", &error)
            })?;
        let (_, logits) = tensor_f32(output_at(&outputs, 0, "joiner output")?, "joiner")?;
        if logits.len() != self.config.vocab_size {
            return Err(TranscriptionError::transcription_failure(
                "Parakeet joiner",
                format!(
                    "expected {} logits, found {}",
                    self.config.vocab_size,
                    logits.len()
                ),
            ));
        }
        logits
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.total_cmp(right))
            .map(|(index, _)| index as i32)
            .ok_or_else(|| {
                TranscriptionError::transcription_failure("Parakeet joiner", "logits were empty")
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
            }]
        };
        Ok(EngineTranscriptOutput {
            segments,
            diagnostics: Vec::new(),
        })
    }
}

impl StreamingModel for LoadedParakeetModel {
    fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError> {
        self.sample_count = self.sample_count.saturating_add(samples.len());
        self.features.accept(samples);
        Ok(())
    }

    fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
        self.process_ready_chunks(false)?;
        self.output()
    }

    fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
        let result = self.process_ready_chunks(true).and_then(|()| self.output());
        self.reset_utterance();
        result
    }

    fn reset_utterance(&mut self) {
        self.features.reset();
        self.last_token = None;
        self.predictor_state_before_last = PredictorState::zeros(&self.config);
        self.processed_feature_frames = 0;
        self.sample_count = 0;
        self.tokens.clear();
    }
}

struct OnlineParakeetFeatures {
    audio: Vec<f32>,
    features: Vec<[f32; FEATURE_DIM]>,
    filterbank: Vec<[f32; FFT_BINS]>,
    fft_planner: RealFftPlanner<f32>,
    finished: bool,
    window: [f32; FRAME_LENGTH_SAMPLES],
}

impl OnlineParakeetFeatures {
    fn new() -> Self {
        Self {
            audio: Vec::new(),
            features: Vec::new(),
            filterbank: build_librosa_filterbank(),
            fft_planner: RealFftPlanner::new(),
            finished: false,
            window: build_periodic_hann_window(),
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
            + (FRAME_SHIFT_SAMPLES / 2) as isize
            - (FRAME_LENGTH_SAMPLES / 2) as isize;
        let mut fft_input = vec![0.0_f32; FFT_SIZE];
        for (offset, sample) in fft_input[..FRAME_LENGTH_SAMPLES].iter_mut().enumerate() {
            let source = reflected_index(start + offset as isize, self.audio.len());
            *sample = self.audio[source];
        }
        for index in (1..FRAME_LENGTH_SAMPLES).rev() {
            fft_input[index] -= PREEMPHASIS_COEFFICIENT * fft_input[index - 1];
        }
        fft_input[0] -= PREEMPHASIS_COEFFICIENT * fft_input[0];
        for (sample, coefficient) in fft_input[..FRAME_LENGTH_SAMPLES]
            .iter_mut()
            .zip(self.window)
        {
            *sample *= coefficient;
        }

        let fft = self.fft_planner.plan_fft_forward(FFT_SIZE);
        let mut fft_output = fft.make_output_vec();
        fft.process(&mut fft_input, &mut fft_output)
            .expect("Parakeet FFT buffers match the planned size");
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
            result[mel_index] = energy.max(f32::EPSILON).ln();
        }
        result
    }

    fn normalized_window(
        &self,
        processed: usize,
        left: usize,
        center: usize,
        right: usize,
    ) -> Vec<f32> {
        let total = left + center + right;
        let window_start = processed as isize - left as isize;
        let mut window = vec![0.0_f32; total * FEATURE_DIM];
        for target_frame in 0..total {
            let source_frame = window_start + target_frame as isize;
            if let Some(source) = usize::try_from(source_frame)
                .ok()
                .and_then(|source| self.features.get(source))
            {
                window[target_frame * FEATURE_DIM..(target_frame + 1) * FEATURE_DIM]
                    .copy_from_slice(source);
            }
        }
        normalize_per_feature(&mut window, total);
        window
    }
}

fn frame_count(sample_count: usize, flush: bool) -> usize {
    let mut count = (sample_count + FRAME_SHIFT_SAMPLES / 2) / FRAME_SHIFT_SAMPLES;
    if flush {
        return count;
    }
    while count > 0 {
        let last_start = (count - 1) as isize * FRAME_SHIFT_SAMPLES as isize
            + (FRAME_SHIFT_SAMPLES / 2) as isize
            - (FRAME_LENGTH_SAMPLES / 2) as isize;
        if last_start + FRAME_LENGTH_SAMPLES as isize <= sample_count as isize {
            break;
        }
        count -= 1;
    }
    count
}

fn reflected_index(mut index: isize, length: usize) -> usize {
    let length = length as isize;
    while index < 0 || index >= length {
        index = if index < 0 {
            -index - 1
        } else {
            2 * length - 1 - index
        };
    }
    index as usize
}

fn build_periodic_hann_window() -> [f32; FRAME_LENGTH_SAMPLES] {
    std::array::from_fn(|index| {
        let phase = 2.0 * std::f32::consts::PI * index as f32 / FRAME_LENGTH_SAMPLES as f32;
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

fn normalize_per_feature(window: &mut [f32], frame_count: usize) {
    for feature in 0..FEATURE_DIM {
        let mean = (0..frame_count)
            .map(|frame| window[frame * FEATURE_DIM + feature])
            .sum::<f32>()
            / frame_count as f32;
        let variance = ((0..frame_count)
            .map(|frame| {
                let value = window[frame * FEATURE_DIM + feature];
                value * value
            })
            .sum::<f32>()
            / frame_count as f32
            - mean * mean)
            .max(0.0);
        let inverse_stddev = 1.0 / (variance.sqrt() + NORMALIZATION_EPSILON);
        for frame in 0..frame_count {
            let value = &mut window[frame * FEATURE_DIM + feature];
            *value = (*value - mean) * inverse_stddev;
        }
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

fn dynamic_value(
    shape: &[usize],
    data: Vec<f32>,
    context: &str,
) -> Result<Tensor<f32>, TranscriptionError> {
    value(Array::from_shape_vec(IxDyn(shape), data), context)
}

fn output_at<'a>(
    outputs: &'a ort::session::SessionOutputs<'_>,
    index: usize,
    name: &str,
) -> Result<&'a DynValue, TranscriptionError> {
    if index >= outputs.len() {
        return Err(TranscriptionError::transcription_failure(
            "Parakeet graph output",
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

fn tensor_f32_data(
    value: &DynValue,
    expected_len: usize,
    name: &str,
) -> Result<Vec<f32>, TranscriptionError> {
    let (shape, data) = tensor_f32(value, name)?;
    if data.len() != expected_len {
        return Err(graph_shape_error(name, &shape));
    }
    Ok(data)
}

fn dimension(shape: &[i64], index: usize, name: &str) -> Result<usize, TranscriptionError> {
    shape
        .get(index)
        .and_then(|value| usize::try_from(*value).ok())
        .ok_or_else(|| graph_shape_error(name, shape))
}

fn graph_shape_error(name: &str, shape: &[i64]) -> TranscriptionError {
    TranscriptionError::transcription_failure(
        "Parakeet graph shape",
        format!("unexpected {name} shape {shape:?}"),
    )
}

#[cfg(test)]
mod tests {
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
    fn reflected_index_matches_kaldi_edge_rules() {
        assert_eq!(reflected_index(-1, 4), 0);
        assert_eq!(reflected_index(-2, 4), 1);
        assert_eq!(reflected_index(4, 4), 3);
        assert_eq!(reflected_index(5, 4), 2);
        assert_eq!(reflected_index(9, 4), 1);
    }

    #[test]
    fn periodic_hann_has_expected_endpoints() {
        let window = build_periodic_hann_window();
        assert_eq!(window[0], 0.0);
        assert!(window[FRAME_LENGTH_SAMPLES / 2] > 0.999);
        assert!(window[FRAME_LENGTH_SAMPLES - 1] > 0.0);
    }

    #[test]
    fn per_feature_normalization_uses_population_variance() {
        let frames = 3;
        let mut window = vec![0.0_f32; frames * FEATURE_DIM];
        window[0] = 1.0;
        window[FEATURE_DIM] = 2.0;
        window[2 * FEATURE_DIM] = 3.0;
        normalize_per_feature(&mut window, frames);
        assert!(window[0] < -1.22 && window[0] > -1.23);
        assert!(window[FEATURE_DIM].abs() < 1e-5);
        assert!(window[2 * FEATURE_DIM] > 1.22 && window[2 * FEATURE_DIM] < 1.23);
    }

    #[test]
    fn tokenizer_requires_contiguous_ids_and_blank_last() {
        let tokenizer = ParakeetTokenizer {
            pieces: vec!["▁hello".to_string(), "<blk>".to_string()],
        };
        tokenizer.validate(2).unwrap();
        assert_eq!(tokenizer.decode(&[0]).unwrap(), "hello");
        assert!(tokenizer.validate(3).is_err());
    }

    #[test]
    fn feature_windows_zero_pad_context_before_normalization() {
        let mut extractor = OnlineParakeetFeatures::new();
        extractor.accept(&vec![0_i16; 8_000]);
        let window = extractor.normalized_window(0, 560, 16, 40);
        assert_eq!(window.len(), 616 * FEATURE_DIM);
        assert!(window.iter().all(|value| value.is_finite()));
    }
}
