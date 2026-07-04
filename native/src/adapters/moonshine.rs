use std::path::{Path, PathBuf};

use ndarray::{Array, Array1, Array2, Array3, IxDyn};
use ort::session::Session;
use ort::value::{DynValue, PrimitiveTensorElementType, Tensor, Value};
use serde::Deserialize;

use crate::engine::capabilities::{
    LanguageSupport, ModelFamilyCapabilities, ModelFamilyId, RuntimeId,
};
use crate::engine::traits::{LoadedModel, ModelFamilyAdapter, StreamingModel};
use crate::protocol::{TimestampGranularity, TimestampSource, TranscriptSegment};
use crate::runtimes::onnx::build_session;
use crate::transcription::{
    EngineTranscriptOutput, GpuConfig, SegmentDiagnostics, TranscriptionError, validate_model_path,
};

const SAMPLE_RATE: usize = 16_000;
const FRONTEND_CHUNK_SAMPLES: usize = 1_280;
const MAX_TOKENS_PER_SECOND: f32 = 6.5;

const FRONTEND_FILENAME: &str = "frontend.ort";
const ENCODER_FILENAME: &str = "encoder.ort";
const ADAPTER_FILENAME: &str = "adapter.ort";
const CROSS_KV_FILENAME: &str = "cross_kv.ort";
const DECODER_KV_FILENAME: &str = "decoder_kv.ort";
const CONFIG_FILENAME: &str = "streaming_config.json";
const TOKENIZER_FILENAME: &str = "tokenizer.bin";

const REQUIRED_SIBLINGS: &[&str] = &[
    FRONTEND_FILENAME,
    ENCODER_FILENAME,
    ADAPTER_FILENAME,
    CROSS_KV_FILENAME,
    DECODER_KV_FILENAME,
    CONFIG_FILENAME,
    TOKENIZER_FILENAME,
];

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
pub struct MoonshineAdapter;

impl ModelFamilyAdapter for MoonshineAdapter {
    fn runtime_id(&self) -> RuntimeId {
        RuntimeId::OnnxRuntime
    }

    fn family_id(&self) -> ModelFamilyId {
        ModelFamilyId::Moonshine
    }

    fn capabilities(&self) -> &ModelFamilyCapabilities {
        &CAPABILITIES
    }

    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError> {
        let paths = resolve_model_paths(path)?;
        let config = load_config(&paths.config)?;
        let tokenizer = MoonshineTokenizer::load(&paths.tokenizer)?;
        if tokenizer.len() != config.vocab_size {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "tokenizer vocabulary mismatch: config declares {}, tokenizer contains {}",
                config.vocab_size,
                tokenizer.len()
            )));
        }

        let frontend =
            build_session(&paths.frontend, GpuConfig { use_gpu: false }).map_err(|error| {
                TranscriptionError::invalid_model_with_details(format!(
                    "frontend session failed to load: {}",
                    error.details.unwrap_or_else(|| error.message.to_string())
                ))
            })?;
        verify_session_io(
            &frontend,
            "frontend",
            &[
                "audio_chunk",
                "sample_buffer",
                "sample_len",
                "conv1_buffer",
                "conv2_buffer",
                "frame_count",
            ],
            &[
                "features",
                "sample_buffer_out",
                "sample_len_out",
                "conv1_buffer_out",
                "conv2_buffer_out",
                "frame_count_out",
            ],
        )?;

        Ok(())
    }

    fn load(
        &self,
        _path: &Path,
        _gpu: GpuConfig,
    ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
        Err(TranscriptionError::unsupported_engine(
            "moonshine requires the streaming session path".to_string(),
        ))
    }

    fn load_streaming(
        &self,
        path: &Path,
        gpu: GpuConfig,
    ) -> Result<Box<dyn StreamingModel>, TranscriptionError> {
        let inference = OrtMoonshineInference::load(path, gpu)?;
        Ok(Box::new(LoadedMoonshineModel::new(inference)))
    }
}

#[derive(Deserialize)]
struct MoonshineConfig {
    encoder_dim: usize,
    decoder_dim: usize,
    depth: usize,
    nheads: usize,
    head_dim: usize,
    vocab_size: usize,
    bos_id: i64,
    eos_id: i64,
    frame_len: usize,
    total_lookahead: usize,
    d_model_frontend: usize,
    c1: usize,
    c2: usize,
    #[serde(default = "default_max_seq_len")]
    max_seq_len: usize,
}

const fn default_max_seq_len() -> usize {
    448
}

struct ModelPaths {
    frontend: PathBuf,
    encoder: PathBuf,
    adapter: PathBuf,
    cross_kv: PathBuf,
    decoder_kv: PathBuf,
    config: PathBuf,
    tokenizer: PathBuf,
}

fn resolve_model_paths(path: &Path) -> Result<ModelPaths, TranscriptionError> {
    validate_model_path(path)?;
    let model_dir = path.parent().ok_or_else(|| {
        TranscriptionError::invalid_model_with_details(
            "cannot determine model directory from artifact path".to_string(),
        )
    })?;

    for filename in REQUIRED_SIBLINGS {
        let sibling = model_dir.join(filename);
        if !sibling.is_file() {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "required Moonshine asset missing: {}",
                sibling.display()
            )));
        }
    }

    Ok(ModelPaths {
        frontend: model_dir.join(FRONTEND_FILENAME),
        encoder: model_dir.join(ENCODER_FILENAME),
        adapter: model_dir.join(ADAPTER_FILENAME),
        cross_kv: model_dir.join(CROSS_KV_FILENAME),
        decoder_kv: model_dir.join(DECODER_KV_FILENAME),
        config: model_dir.join(CONFIG_FILENAME),
        tokenizer: model_dir.join(TOKENIZER_FILENAME),
    })
}

fn load_config(path: &Path) -> Result<MoonshineConfig, TranscriptionError> {
    let bytes = std::fs::read(path).map_err(|error| {
        TranscriptionError::invalid_model_with_details(format!(
            "failed to read {}: {error}",
            path.display()
        ))
    })?;
    let config: MoonshineConfig = serde_json::from_slice(&bytes).map_err(|error| {
        TranscriptionError::invalid_model_with_details(format!(
            "failed to parse {CONFIG_FILENAME}: {error}"
        ))
    })?;

    if config.encoder_dim == 0
        || config.decoder_dim == 0
        || config.depth == 0
        || config.nheads == 0
        || config.head_dim == 0
        || config.vocab_size == 0
        || config.frame_len == 0
        || config.d_model_frontend == 0
        || config.c1 == 0
        || config.c2 == 0
    {
        return Err(TranscriptionError::invalid_model(
            "streaming_config.json contains a zero model dimension",
        ));
    }

    Ok(config)
}

fn verify_session_io(
    session: &Session,
    graph_name: &str,
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
            "{graph_name} graph I/O mismatch: inputs {actual_inputs:?}, outputs {actual_outputs:?}"
        )));
    }

    Ok(())
}

#[derive(Debug)]
struct MoonshineTokenizer {
    tokens: Vec<Vec<u8>>,
}

impl MoonshineTokenizer {
    fn load(path: &Path) -> Result<Self, TranscriptionError> {
        let bytes = std::fs::read(path).map_err(|error| {
            TranscriptionError::invalid_model_with_details(format!(
                "failed to read {}: {error}",
                path.display()
            ))
        })?;
        Self::parse(&bytes)
    }

    fn parse(bytes: &[u8]) -> Result<Self, TranscriptionError> {
        let mut tokens = Vec::new();
        let mut offset = 0;

        while offset < bytes.len() {
            let first = bytes[offset];
            offset += 1;
            let length = if first == 0 {
                0
            } else if first < 128 {
                usize::from(first)
            } else {
                let second = *bytes.get(offset).ok_or_else(|| {
                    TranscriptionError::invalid_model(
                        "tokenizer.bin ends inside a token length prefix",
                    )
                })?;
                offset += 1;
                usize::from(second) * 128 + usize::from(first) - 128
            };

            let end = offset.checked_add(length).ok_or_else(|| {
                TranscriptionError::invalid_model("tokenizer.bin token length overflow")
            })?;
            let token = bytes.get(offset..end).ok_or_else(|| {
                TranscriptionError::invalid_model("tokenizer.bin ends inside token bytes")
            })?;
            tokens.push(token.to_vec());
            offset = end;
        }

        if tokens.is_empty() {
            return Err(TranscriptionError::invalid_model(
                "tokenizer.bin contains no tokens",
            ));
        }

        Ok(Self { tokens })
    }

    fn len(&self) -> usize {
        self.tokens.len()
    }

    fn decode(&self, token_ids: &[i64]) -> Result<String, TranscriptionError> {
        let mut bytes = Vec::new();
        for &token_id in token_ids {
            let token = usize::try_from(token_id)
                .ok()
                .and_then(|index| self.tokens.get(index))
                .ok_or_else(|| {
                    TranscriptionError::transcription_failure(
                        "tokenizer decode",
                        format!("token ID {token_id} is outside the vocabulary"),
                    )
                })?;
            if token.len() > 2 && token.first() == Some(&b'<') && token.last() == Some(&b'>') {
                continue;
            }
            bytes.extend_from_slice(token);
        }

        let text = String::from_utf8_lossy(&bytes).replace('▁', " ");
        Ok(text.trim().to_string())
    }

    #[cfg(test)]
    fn encode(&self, text: &str) -> Result<Vec<i64>, TranscriptionError> {
        let normalized = text.replace(' ', "▁");
        let mut remaining = normalized.as_bytes();
        let mut token_ids = Vec::new();

        while !remaining.is_empty() {
            let (token_id, token) = self
                .tokens
                .iter()
                .enumerate()
                .filter(|(_, token)| !token.is_empty() && remaining.starts_with(token))
                .max_by_key(|(_, token)| token.len())
                .ok_or_else(|| {
                    TranscriptionError::transcription_failure(
                        "tokenizer encode",
                        "input has no vocabulary match",
                    )
                })?;
            token_ids.push(token_id as i64);
            remaining = &remaining[token.len()..];
        }

        Ok(token_ids)
    }
}

struct DecodedTranscript {
    reached_eos: bool,
    text: String,
    token_count: u32,
}

trait MoonshineInference: Send {
    fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError>;
    fn decode(&mut self, is_final: bool) -> Result<DecodedTranscript, TranscriptionError>;
    fn reset(&mut self);
    fn sample_count(&self) -> usize;
}

struct LoadedMoonshineModel<I> {
    inference: I,
}

impl<I> LoadedMoonshineModel<I> {
    fn new(inference: I) -> Self {
        Self { inference }
    }
}

impl<I: MoonshineInference> StreamingModel for LoadedMoonshineModel<I> {
    fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError> {
        self.inference.accept_audio(samples)
    }

    fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
        let decoded = self.inference.decode(false)?;
        Ok(engine_output(decoded, self.inference.sample_count()))
    }

    fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
        let sample_count = self.inference.sample_count();
        let result = self
            .inference
            .decode(true)
            .map(|decoded| engine_output(decoded, sample_count));
        self.inference.reset();
        result
    }

    fn reset_utterance(&mut self) {
        self.inference.reset();
    }
}

fn engine_output(decoded: DecodedTranscript, sample_count: usize) -> EngineTranscriptOutput {
    let text = decoded.text.trim();
    if text.is_empty() {
        return EngineTranscriptOutput {
            segments: Vec::new(),
            diagnostics: Vec::new(),
        };
    }

    let segment = TranscriptSegment {
        end_ms: (sample_count as u64 * 1_000) / SAMPLE_RATE as u64,
        speaker: None,
        start_ms: 0,
        text: text.to_string(),
        timestamp_granularity: TimestampGranularity::Utterance,
        timestamp_source: TimestampSource::Vad,
    };
    let diagnostics = SegmentDiagnostics {
        avg_logprob: None,
        decode_reached_eos: Some(decoded.reached_eos),
        no_speech_prob: None,
        token_count: Some(decoded.token_count),
    };

    EngineTranscriptOutput {
        segments: vec![segment],
        diagnostics: vec![diagnostics],
    }
}

struct StreamingState {
    accumulated_feature_count: usize,
    accumulated_features: Vec<f32>,
    adapter_pos_offset: i64,
    cache_seq_len: usize,
    conv1_buffer: Vec<f32>,
    conv2_buffer: Vec<f32>,
    cross_kv_frames: usize,
    cross_len: usize,
    encoder_frames_emitted: usize,
    frame_count: i64,
    k_cross: Vec<f32>,
    k_self: Vec<f32>,
    memory: Vec<f32>,
    memory_len: usize,
    pending_audio: Vec<f32>,
    sample_buffer: Vec<f32>,
    sample_count: usize,
    sample_len: i64,
    v_cross: Vec<f32>,
    v_self: Vec<f32>,
}

impl StreamingState {
    fn new(config: &MoonshineConfig) -> Self {
        Self {
            accumulated_feature_count: 0,
            accumulated_features: Vec::new(),
            adapter_pos_offset: 0,
            cache_seq_len: 0,
            conv1_buffer: vec![0.0; config.d_model_frontend * 4],
            conv2_buffer: vec![0.0; config.c1 * 4],
            cross_kv_frames: 0,
            cross_len: 0,
            encoder_frames_emitted: 0,
            frame_count: 0,
            k_cross: Vec::new(),
            k_self: Vec::new(),
            memory: Vec::new(),
            memory_len: 0,
            pending_audio: Vec::new(),
            sample_buffer: vec![0.0; 79],
            sample_count: 0,
            sample_len: 0,
            v_cross: Vec::new(),
            v_self: Vec::new(),
        }
    }
}

struct OrtMoonshineInference {
    adapter: Session,
    config: MoonshineConfig,
    cross_kv: Session,
    decoder_kv: Session,
    encoder: Session,
    frontend: Session,
    state: StreamingState,
    tokenizer: MoonshineTokenizer,
}

impl OrtMoonshineInference {
    fn load(path: &Path, gpu: GpuConfig) -> Result<Self, TranscriptionError> {
        let paths = resolve_model_paths(path)?;
        let config = load_config(&paths.config)?;
        let tokenizer = MoonshineTokenizer::load(&paths.tokenizer)?;
        if tokenizer.len() != config.vocab_size {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "tokenizer vocabulary mismatch: config declares {}, tokenizer contains {}",
                config.vocab_size,
                tokenizer.len()
            )));
        }

        let frontend = build_session(&paths.frontend, gpu)?;
        let encoder = build_session(&paths.encoder, gpu)?;
        let adapter = build_session(&paths.adapter, gpu)?;
        let cross_kv = build_session(&paths.cross_kv, gpu)?;
        let decoder_kv = build_session(&paths.decoder_kv, gpu)?;
        verify_session_io(&encoder, "encoder", &["features"], &["encoded"])?;
        verify_session_io(&adapter, "adapter", &["encoded", "pos_offset"], &["memory"])?;
        verify_session_io(&cross_kv, "cross_kv", &["memory"], &["k_cross", "v_cross"])?;
        verify_session_io(
            &decoder_kv,
            "decoder_kv",
            &["token", "k_self", "v_self", "out_k_cross", "out_v_cross"],
            &[
                "logits",
                "out_k_self",
                "out_v_self",
                "out_k_cross",
                "out_v_cross",
            ],
        )?;
        let state = StreamingState::new(&config);

        Ok(Self {
            adapter,
            config,
            cross_kv,
            decoder_kv,
            encoder,
            frontend,
            state,
            tokenizer,
        })
    }

    fn process_complete_chunks(&mut self) -> Result<(), TranscriptionError> {
        let process_len =
            (self.state.pending_audio.len() / FRONTEND_CHUNK_SAMPLES) * FRONTEND_CHUNK_SAMPLES;
        if process_len == 0 {
            return Ok(());
        }

        let mut pending = std::mem::take(&mut self.state.pending_audio);
        self.state.pending_audio = pending.split_off(process_len);
        for chunk in pending.chunks_exact(FRONTEND_CHUNK_SAMPLES) {
            self.process_frontend_chunk(chunk)?;
        }
        Ok(())
    }

    fn flush_pending_audio(&mut self) -> Result<(), TranscriptionError> {
        if self.state.pending_audio.is_empty() {
            return Ok(());
        }

        let mut chunk = std::mem::take(&mut self.state.pending_audio);
        chunk.resize(FRONTEND_CHUNK_SAMPLES, 0.0);
        self.process_frontend_chunk(&chunk)
    }

    fn process_frontend_chunk(&mut self, chunk: &[f32]) -> Result<(), TranscriptionError> {
        let audio = value(
            Array2::from_shape_vec((1, chunk.len()), chunk.to_vec()),
            "audio",
        )?;
        let sample_buffer = value(
            Array2::from_shape_vec((1, 79), self.state.sample_buffer.clone()),
            "sample buffer",
        )?;
        let sample_len = value(
            Ok(Array1::from_vec(vec![self.state.sample_len])),
            "sample length",
        )?;
        let conv1 = value(
            Array3::from_shape_vec(
                (1, self.config.d_model_frontend, 4),
                self.state.conv1_buffer.clone(),
            ),
            "conv1 buffer",
        )?;
        let conv2 = value(
            Array3::from_shape_vec((1, self.config.c1, 4), self.state.conv2_buffer.clone()),
            "conv2 buffer",
        )?;
        let frame_count = value(
            Ok(Array1::from_vec(vec![self.state.frame_count])),
            "frame count",
        )?;

        let outputs = self
            .frontend
            .run(ort::inputs![
                "audio_chunk" => audio,
                "sample_buffer" => sample_buffer,
                "sample_len" => sample_len,
                "conv1_buffer" => conv1,
                "conv2_buffer" => conv2,
                "frame_count" => frame_count,
            ])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Moonshine frontend", &error)
            })?;

        let (feature_shape, features) = tensor_f32(output(&outputs, "features")?, "features")?;
        let feature_count = dimension(&feature_shape, 1, "features")?;
        if dimension(&feature_shape, 2, "features")? != self.config.encoder_dim {
            return Err(shape_error("features", &feature_shape));
        }
        self.state.accumulated_features.extend(features);
        self.state.accumulated_feature_count += feature_count;

        self.state.sample_buffer = tensor_f32_data(
            output(&outputs, "sample_buffer_out")?,
            79,
            "sample_buffer_out",
        )?;
        self.state.sample_len =
            tensor_i64_scalar(output(&outputs, "sample_len_out")?, "sample_len_out")?;
        self.state.conv1_buffer = tensor_f32_data(
            output(&outputs, "conv1_buffer_out")?,
            self.config.d_model_frontend * 4,
            "conv1_buffer_out",
        )?;
        self.state.conv2_buffer = tensor_f32_data(
            output(&outputs, "conv2_buffer_out")?,
            self.config.c1 * 4,
            "conv2_buffer_out",
        )?;
        self.state.frame_count =
            tensor_i64_scalar(output(&outputs, "frame_count_out")?, "frame_count_out")?;
        Ok(())
    }

    fn encode_available(&mut self, is_final: bool) -> Result<(), TranscriptionError> {
        let total_features = self.state.accumulated_feature_count;
        let stable_count = if is_final {
            total_features
        } else {
            total_features.saturating_sub(self.config.total_lookahead)
        };
        let new_frames = stable_count.saturating_sub(self.state.encoder_frames_emitted);
        if new_frames == 0 {
            return Ok(());
        }

        let left_context_frames = 16 * self.config.depth;
        let window_start = self
            .state
            .encoder_frames_emitted
            .saturating_sub(left_context_frames);
        let window_size = total_features - window_start;
        let feature_offset = window_start * self.config.encoder_dim;
        let window = self.state.accumulated_features
            [feature_offset..feature_offset + window_size * self.config.encoder_dim]
            .to_vec();
        let features = value(
            Array3::from_shape_vec((1, window_size, self.config.encoder_dim), window),
            "encoder features",
        )?;
        let outputs = self
            .encoder
            .run(ort::inputs!["features" => features])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Moonshine encoder", &error)
            })?;
        let (encoded_shape, encoded) = tensor_f32(output(&outputs, "encoded")?, "encoded")?;
        let total_encoded = dimension(&encoded_shape, 1, "encoded")?;
        if dimension(&encoded_shape, 2, "encoded")? != self.config.encoder_dim {
            return Err(shape_error("encoded", &encoded_shape));
        }
        let start_index = self.state.encoder_frames_emitted - window_start;
        if start_index + new_frames > total_encoded {
            return Err(TranscriptionError::transcription_failure(
                "Moonshine encoder window",
                format!(
                    "new frame range {}..{} exceeds encoded length {total_encoded}",
                    start_index,
                    start_index + new_frames
                ),
            ));
        }
        let encoded_start = start_index * self.config.encoder_dim;
        let encoded_end = (start_index + new_frames) * self.config.encoder_dim;
        let encoded_slice = value(
            Array3::from_shape_vec(
                (1, new_frames, self.config.encoder_dim),
                encoded[encoded_start..encoded_end].to_vec(),
            ),
            "adapter encoded slice",
        )?;
        let position = value(
            Ok(Array1::from_vec(vec![self.state.adapter_pos_offset])),
            "adapter position",
        )?;
        let outputs = self
            .adapter
            .run(ort::inputs![
                "encoded" => encoded_slice,
                "pos_offset" => position,
            ])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Moonshine adapter", &error)
            })?;
        let memory = tensor_f32_data(
            output(&outputs, "memory")?,
            new_frames * self.config.decoder_dim,
            "memory",
        )?;
        self.state.memory.extend(memory);
        self.state.memory_len += new_frames;
        self.state.encoder_frames_emitted = stable_count;
        self.state.adapter_pos_offset += new_frames as i64;
        Ok(())
    }

    fn compute_cross_kv(&mut self) -> Result<(), TranscriptionError> {
        if self.state.cross_kv_frames == self.state.memory_len {
            return Ok(());
        }
        if self.state.memory_len == 0 {
            return Err(TranscriptionError::transcription_failure(
                "Moonshine cross attention",
                "encoder memory is empty",
            ));
        }

        let new_frames = self.state.memory_len - self.state.cross_kv_frames;
        let offset = self.state.cross_kv_frames * self.config.decoder_dim;
        let memory = value(
            Array3::from_shape_vec(
                (1, new_frames, self.config.decoder_dim),
                self.state.memory[offset..].to_vec(),
            ),
            "cross attention memory (delta)",
        )?;
        let outputs = self
            .cross_kv
            .run(ort::inputs!["memory" => memory])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Moonshine cross attention", &error)
            })?;
        let (shape, k_delta) = tensor_f32(output(&outputs, "k_cross")?, "k_cross")?;
        if shape.len() != 5
            || dimension(&shape, 0, "k_cross")? != self.config.depth
            || dimension(&shape, 2, "k_cross")? != self.config.nheads
            || dimension(&shape, 4, "k_cross")? != self.config.head_dim
        {
            return Err(shape_error("k_cross", &shape));
        }
        let delta_len = dimension(&shape, 3, "k_cross")?;
        if delta_len != new_frames {
            return Err(shape_error("k_cross", &shape));
        }
        let expected = self.config.depth * self.config.nheads * delta_len * self.config.head_dim;
        let v_delta = tensor_f32_data(output(&outputs, "v_cross")?, expected, "v_cross")?;
        if k_delta.len() != expected {
            return Err(shape_error("k_cross", &shape));
        }

        let slabs = self.config.depth * self.config.nheads;
        append_cross_kv(
            &mut self.state.k_cross,
            &k_delta,
            self.state.cross_len,
            delta_len,
            slabs,
            self.config.head_dim,
        );
        append_cross_kv(
            &mut self.state.v_cross,
            &v_delta,
            self.state.cross_len,
            delta_len,
            slabs,
            self.config.head_dim,
        );
        self.state.cross_len += delta_len;
        self.state.cross_kv_frames = self.state.memory_len;
        Ok(())
    }

    fn reset_decoder(&mut self) {
        self.state.cache_seq_len = 0;
        self.state.k_self.clear();
        self.state.v_self.clear();
    }

    fn decode_step(&mut self, token: i64) -> Result<i64, TranscriptionError> {
        self.compute_cross_kv()?;
        let token = value(Array2::from_shape_vec((1, 1), vec![token]), "decoder token")?;
        let self_shape = [
            self.config.depth,
            1,
            self.config.nheads,
            self.state.cache_seq_len,
            self.config.head_dim,
        ];
        let self_size = self_shape.iter().product();
        if self.state.k_self.len() != self_size {
            self.state.k_self.resize(self_size, 0.0);
            self.state.v_self.resize(self_size, 0.0);
        }
        let cross_shape = [
            self.config.depth,
            1,
            self.config.nheads,
            self.state.cross_len,
            self.config.head_dim,
        ];
        let k_self = dynamic_value(&self_shape, self.state.k_self.clone(), "decoder k_self")?;
        let v_self = dynamic_value(&self_shape, self.state.v_self.clone(), "decoder v_self")?;
        let k_cross = dynamic_value(&cross_shape, self.state.k_cross.clone(), "decoder k_cross")?;
        let v_cross = dynamic_value(&cross_shape, self.state.v_cross.clone(), "decoder v_cross")?;

        let outputs = self
            .decoder_kv
            .run(ort::inputs![
                "token" => token,
                "k_self" => k_self,
                "v_self" => v_self,
                "out_k_cross" => k_cross,
                "out_v_cross" => v_cross,
            ])
            .map_err(|error| {
                TranscriptionError::transcription_failure("Moonshine decoder", &error)
            })?;
        let (logits_shape, logits) = tensor_f32(output(&outputs, "logits")?, "logits")?;
        if logits_shape != [1, 1, self.config.vocab_size as i64] {
            return Err(shape_error("logits", &logits_shape));
        }
        let (cache_shape, k_self) = tensor_f32(output(&outputs, "out_k_self")?, "out_k_self")?;
        if cache_shape.len() != 5 {
            return Err(shape_error("out_k_self", &cache_shape));
        }
        let cache_len = dimension(&cache_shape, 3, "out_k_self")?;
        let cache_size = self.config.depth * self.config.nheads * cache_len * self.config.head_dim;
        let v_self = tensor_f32_data(output(&outputs, "out_v_self")?, cache_size, "out_v_self")?;
        if k_self.len() != cache_size {
            return Err(shape_error("out_k_self", &cache_shape));
        }
        self.state.k_self = k_self;
        self.state.v_self = v_self;
        self.state.cache_seq_len = cache_len;

        logits
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.total_cmp(right))
            .map(|(index, _)| index as i64)
            .ok_or_else(|| {
                TranscriptionError::transcription_failure("Moonshine decoder", "logits were empty")
            })
    }

    fn decode_text(&mut self) -> Result<DecodedTranscript, TranscriptionError> {
        if self.state.memory_len == 0 {
            return Ok(DecodedTranscript {
                reached_eos: false,
                text: String::new(),
                token_count: 0,
            });
        }

        self.reset_decoder();
        let duration_seconds = self.state.sample_count as f32 / SAMPLE_RATE as f32;
        let max_tokens = ((duration_seconds * MAX_TOKENS_PER_SECOND).ceil() as usize)
            .min(self.config.max_seq_len);
        let mut generated = Vec::new();
        let mut current = self.config.bos_id;
        let mut reached_eos = false;

        for _ in 0..max_tokens {
            let next = self.decode_step(current)?;
            if next == self.config.eos_id {
                reached_eos = true;
                break;
            }
            generated.push(next);
            current = next;
        }

        Ok(DecodedTranscript {
            reached_eos,
            text: self.tokenizer.decode(&generated)?,
            token_count: generated.len() as u32,
        })
    }
}

/// Grow a `[slabs, old_len, head_dim]` flat buffer by interleaving each slab's
/// `[delta_len, head_dim]` rows after that slab's existing rows.
fn append_cross_kv(
    dst: &mut Vec<f32>,
    src: &[f32],
    old_len: usize,
    delta_len: usize,
    slabs: usize,
    head_dim: usize,
) {
    debug_assert_eq!(dst.len(), slabs * old_len * head_dim);
    debug_assert_eq!(src.len(), slabs * delta_len * head_dim);

    let new_len = old_len + delta_len;
    let mut grown = vec![0.0_f32; slabs * new_len * head_dim];
    for slab in 0..slabs {
        let old_slab = slab * old_len * head_dim;
        let new_slab = slab * new_len * head_dim;
        let keep = old_len * head_dim;
        grown[new_slab..new_slab + keep].copy_from_slice(&dst[old_slab..old_slab + keep]);

        let src_slab = slab * delta_len * head_dim;
        let add = delta_len * head_dim;
        grown[new_slab + keep..new_slab + keep + add]
            .copy_from_slice(&src[src_slab..src_slab + add]);
    }
    *dst = grown;
}

impl MoonshineInference for OrtMoonshineInference {
    fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError> {
        self.state.sample_count += samples.len();
        self.state
            .pending_audio
            .extend(samples.iter().map(|sample| f32::from(*sample) / 32_768.0));
        self.process_complete_chunks()
    }

    fn decode(&mut self, is_final: bool) -> Result<DecodedTranscript, TranscriptionError> {
        if is_final {
            self.flush_pending_audio()?;
        }
        self.encode_available(is_final)?;
        self.decode_text()
    }

    fn reset(&mut self) {
        self.state = StreamingState::new(&self.config);
    }

    fn sample_count(&self) -> usize {
        self.state.sample_count
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

fn output<'a>(
    outputs: &'a ort::session::SessionOutputs<'_>,
    name: &str,
) -> Result<&'a DynValue, TranscriptionError> {
    outputs.get(name).ok_or_else(|| {
        TranscriptionError::transcription_failure(
            "Moonshine graph output",
            format!("missing {name}"),
        )
    })
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
        return Err(shape_error(name, &shape));
    }
    Ok(data)
}

fn tensor_i64_scalar(value: &DynValue, name: &str) -> Result<i64, TranscriptionError> {
    let (shape, data) = value
        .try_extract_tensor::<i64>()
        .map_err(|error| TranscriptionError::transcription_failure(name, &error))?;
    if data.len() != 1 {
        return Err(shape_error(name, shape));
    }
    Ok(data[0])
}

fn dimension(shape: &[i64], index: usize, name: &str) -> Result<usize, TranscriptionError> {
    shape
        .get(index)
        .and_then(|value| usize::try_from(*value).ok())
        .ok_or_else(|| shape_error(name, shape))
}

fn shape_error(name: &str, shape: &[i64]) -> TranscriptionError {
    TranscriptionError::transcription_failure(
        "Moonshine graph shape",
        format!("unexpected {name} shape {shape:?}"),
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn capabilities_describe_streaming_english_output() {
        let adapter = MoonshineAdapter;
        let capabilities = adapter.capabilities();

        assert!(capabilities.supports_streaming);
        assert!(!capabilities.supports_initial_prompt);
        assert!(!capabilities.supports_language_selection);
        assert_eq!(
            capabilities.supported_languages,
            LanguageSupport::EnglishOnly
        );
        assert!(capabilities.produces_punctuation);
    }

    #[test]
    fn tokenizer_round_trip_preserves_spaces_and_punctuation() {
        let tokenizer = MoonshineTokenizer {
            tokens: vec![
                b"<unk>".to_vec(),
                b"<s>".to_vec(),
                b"</s>".to_vec(),
                b"Hello".to_vec(),
                "▁world".as_bytes().to_vec(),
                b".".to_vec(),
            ],
        };

        let tokens = tokenizer.encode("Hello world.").unwrap();
        assert_eq!(tokens, vec![3, 4, 5]);
        assert_eq!(tokenizer.decode(&tokens).unwrap(), "Hello world.");
        assert_eq!(tokenizer.decode(&[1, 3, 4, 5, 2]).unwrap(), "Hello world.");
    }

    #[test]
    fn tokenizer_rejects_truncated_token_bytes() {
        let error = MoonshineTokenizer::parse(&[4, b'a']).unwrap_err();
        assert_eq!(error.code, "invalid_model_file");
    }

    #[test]
    fn append_cross_kv_preserves_each_slab() {
        let mut cache = vec![1.0, 2.0, 10.0, 20.0];
        let delta = vec![3.0, 30.0];

        append_cross_kv(&mut cache, &delta, 2, 1, 2, 1);

        assert_eq!(cache, vec![1.0, 2.0, 3.0, 10.0, 20.0, 30.0]);
    }

    #[test]
    fn probe_reports_missing_sibling() {
        let root = temp_dir("missing-sibling");
        fs::create_dir_all(&root).unwrap();
        let frontend = root.join(FRONTEND_FILENAME);
        fs::write(&frontend, b"not a graph").unwrap();

        let error = MoonshineAdapter.probe_model(&frontend).unwrap_err();
        assert_eq!(error.code, "invalid_model_file");
        assert!(error.details.unwrap_or_default().contains(ENCODER_FILENAME));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn partial_and_finalize_contract_resets_after_fixture() {
        let inference = FixtureInference::default();
        let mut model = LoadedMoonshineModel::new(inference);

        model.accept_audio(&vec![1; 8_000]).unwrap();
        let partial = model.partial().unwrap();
        assert_eq!(partial.segments[0].text, "fixture partial");
        assert_eq!(partial.segments[0].end_ms, 500);

        model.accept_audio(&vec![1; 8_000]).unwrap();
        let final_output = model.finalize_utterance().unwrap();
        assert_eq!(final_output.segments[0].text, "fixture final.");
        assert_eq!(final_output.segments[0].end_ms, 1_000);
        assert_eq!(model.partial().unwrap().segments, Vec::new());
    }

    #[test]
    #[ignore = "requires MOONSHINE_MODEL_PATH pointing to local streaming assets"]
    fn cross_kv_projection_is_per_frame_independent() {
        let model_path = std::env::var("MOONSHINE_MODEL_PATH")
            .expect("MOONSHINE_MODEL_PATH must point to frontend.ort");
        let mut inference =
            OrtMoonshineInference::load(Path::new(&model_path), GpuConfig { use_gpu: false })
                .unwrap();

        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio/7021-79740-0000.wav");
        let samples: Vec<i16> = hound::WavReader::open(fixture)
            .unwrap()
            .samples::<i16>()
            .map(Result::unwrap)
            .collect();
        inference.accept_audio(&samples[..32_000]).unwrap();
        inference.encode_available(false).unwrap();
        assert!(
            inference.state.memory_len > 4,
            "need enough memory frames to split"
        );

        let full = project_cross_kv_full(
            &mut inference.cross_kv,
            &inference.state.memory,
            inference.state.memory_len,
            &inference.config,
        )
        .unwrap();
        let half = inference.state.memory_len / 2;
        let prefix_len = half * inference.config.decoder_dim;
        let prefix = project_cross_kv_full(
            &mut inference.cross_kv,
            &inference.state.memory[..prefix_len],
            half,
            &inference.config,
        )
        .unwrap();

        assert_cross_prefix_matches(
            &full,
            &prefix,
            half,
            inference.state.memory_len,
            &inference.config,
        );
    }

    #[test]
    #[ignore = "requires MOONSHINE_MODEL_PATH pointing to local streaming assets"]
    fn local_model_decodes_fixture_in_streaming_chunks() {
        let model_path = std::env::var("MOONSHINE_MODEL_PATH")
            .expect("MOONSHINE_MODEL_PATH must point to frontend.ort");
        let mut model = MoonshineAdapter
            .load_streaming(Path::new(&model_path), GpuConfig { use_gpu: false })
            .unwrap();
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio/7021-79740-0000.wav");
        let mut reader = hound::WavReader::open(fixture).unwrap();
        let samples: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();

        for frame in samples.chunks(320) {
            model.accept_audio(frame).unwrap();
        }
        let partial = model.partial().unwrap();
        let final_output = model.finalize_utterance().unwrap();

        let mut one_shot = MoonshineAdapter
            .load_streaming(Path::new(&model_path), GpuConfig { use_gpu: false })
            .unwrap();
        one_shot.accept_audio(&samples).unwrap();
        let one_shot_output = one_shot.finalize_utterance().unwrap();

        assert!(!partial.segments.is_empty());
        assert!(!final_output.segments.is_empty());
        assert!(!final_output.segments[0].text.trim().is_empty());
        assert_eq!(final_output.segments[0].end_ms, samples.len() as u64 / 16);
        assert_eq!(final_output, one_shot_output);
    }

    fn project_cross_kv_full(
        session: &mut Session,
        memory: &[f32],
        memory_len: usize,
        config: &MoonshineConfig,
    ) -> Result<(Vec<f32>, Vec<f32>, usize), TranscriptionError> {
        let memory = value(
            Array3::from_shape_vec((1, memory_len, config.decoder_dim), memory.to_vec()),
            "test cross attention memory",
        )?;
        let outputs = session
            .run(ort::inputs!["memory" => memory])
            .map_err(|error| {
                TranscriptionError::transcription_failure("test Moonshine cross attention", &error)
            })?;
        let (shape, k_cross) = tensor_f32(output(&outputs, "k_cross")?, "k_cross")?;
        if shape.len() != 5
            || dimension(&shape, 0, "k_cross")? != config.depth
            || dimension(&shape, 2, "k_cross")? != config.nheads
            || dimension(&shape, 4, "k_cross")? != config.head_dim
        {
            return Err(shape_error("k_cross", &shape));
        }
        let cross_len = dimension(&shape, 3, "k_cross")?;
        let expected = config.depth * config.nheads * cross_len * config.head_dim;
        let v_cross = tensor_f32_data(output(&outputs, "v_cross")?, expected, "v_cross")?;
        if k_cross.len() != expected {
            return Err(shape_error("k_cross", &shape));
        }
        Ok((k_cross, v_cross, cross_len))
    }

    fn assert_cross_prefix_matches(
        full: &(Vec<f32>, Vec<f32>, usize),
        prefix: &(Vec<f32>, Vec<f32>, usize),
        prefix_len: usize,
        full_len: usize,
        config: &MoonshineConfig,
    ) {
        assert_eq!(full.2, full_len);
        assert_eq!(prefix.2, prefix_len);
        let slabs = config.depth * config.nheads;

        for slab in 0..slabs {
            for position in 0..prefix_len {
                for channel in 0..config.head_dim {
                    let full_index = (slab * full_len + position) * config.head_dim + channel;
                    let prefix_index = (slab * prefix_len + position) * config.head_dim + channel;
                    assert!(
                        (full.0[full_index] - prefix.0[prefix_index]).abs() < 1.0e-4,
                        "k_cross differs at slab {slab}, position {position}, channel {channel}"
                    );
                    assert!(
                        (full.1[full_index] - prefix.1[prefix_index]).abs() < 1.0e-4,
                        "v_cross differs at slab {slab}, position {position}, channel {channel}"
                    );
                }
            }
        }
    }

    #[derive(Default)]
    struct FixtureInference {
        samples: usize,
    }

    impl MoonshineInference for FixtureInference {
        fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError> {
            self.samples += samples.len();
            Ok(())
        }

        fn decode(&mut self, is_final: bool) -> Result<DecodedTranscript, TranscriptionError> {
            let text = if self.samples == 0 {
                ""
            } else if is_final {
                "fixture final."
            } else {
                "fixture partial"
            };
            Ok(DecodedTranscript {
                reached_eos: is_final,
                text: text.to_string(),
                token_count: text.split_whitespace().count() as u32,
            })
        }

        fn reset(&mut self) {
            self.samples = 0;
        }

        fn sample_count(&self) -> usize {
            self.samples
        }
    }

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("moonshine-{label}-{}-{nonce}", std::process::id()))
    }
}
