#![cfg(feature = "engine-pocket-tts")]

use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use ndarray::{ArrayD, IxDyn};
use ort::session::Session;
use ort::session::SessionInputValue;
use ort::value::{DynValue, Value};
use safetensors::{Dtype, SafeTensors};
use sentencepiece_rs::SentencePieceProcessor;
use serde::Deserialize;

use crate::engine::capabilities::{
    LanguageSupport, ModelFamilyCapabilities, ModelFamilyId, ModelTask, RuntimeId,
};
use crate::engine::traits::{LoadedModel, ModelFamilyAdapter};
use crate::synthesis::{SynthesisCancellation, SynthesisError, SynthesisModel, SynthesisPcm};
use crate::transcription::{GpuConfig, TranscriptionError, validate_model_path};

const SAMPLE_RATE: u32 = 24_000;
const LATENT_DECODE_CHUNK: usize = 12;
const TOKENS_PER_SECOND: f32 = 3.0;
const GENERATION_PADDING_SECONDS: f32 = 2.0;

static CAPABILITIES: LazyLock<ModelFamilyCapabilities> =
    LazyLock::new(|| ModelFamilyCapabilities {
        task: ModelTask::Tts,
        supports_hardware_acceleration: false,
        available_voices: vec![
            "alba".to_string(),
            "cosette".to_string(),
            "fantine".to_string(),
            "javert".to_string(),
            "jean".to_string(),
            "marius".to_string(),
        ],
        supports_speed_control: true,
        output_sample_rate: Some(SAMPLE_RATE),
        supports_segment_timestamps: false,
        supports_word_timestamps: false,
        supports_initial_prompt: false,
        supports_streaming: true,
        supports_language_selection: false,
        supports_automatic_language_detection: false,
        supported_languages: LanguageSupport::List {
            tags: ["en", "fr", "de", "es", "pt", "it"]
                .into_iter()
                .map(str::to_string)
                .collect(),
        },
        max_audio_duration_secs: None,
        produces_punctuation: false,
    });

pub struct PocketTtsAdapter;

impl ModelFamilyAdapter for PocketTtsAdapter {
    fn runtime_id(&self) -> RuntimeId {
        RuntimeId::OnnxRuntime
    }

    fn family_id(&self) -> ModelFamilyId {
        ModelFamilyId::PocketTts
    }

    fn capabilities(&self) -> &ModelFamilyCapabilities {
        &CAPABILITIES
    }

    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError> {
        PocketTtsModel::load(path)
            .map(|_| ())
            .map_err(|error| TranscriptionError::invalid_model_with_details(error.to_string()))
    }

    fn load(
        &self,
        _path: &Path,
        _gpu: GpuConfig,
    ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
        Err(TranscriptionError::unsupported_engine(
            "Pocket TTS is available only through the synthesis path.".to_string(),
        ))
    }

    fn load_synthesis(&self, path: &Path) -> Result<Box<dyn SynthesisModel>, SynthesisError> {
        Ok(Box::new(PocketTtsModel::load(path)?))
    }
}

#[derive(Debug, Deserialize)]
struct BundleConfig {
    conditioning_dim: usize,
    flow_lm_state_manifest: Vec<StateEntry>,
    frame_rate: f32,
    latent_dim: usize,
    mimi_state_manifest: Vec<StateEntry>,
    model_recommended_frames_after_eos: Option<usize>,
    pad_with_spaces_for_short_inputs: bool,
    remove_semicolons: bool,
    sample_rate: u32,
    samples_per_frame: usize,
    tokenizer_file: String,
}

#[derive(Debug, Clone, Deserialize)]
struct StateEntry {
    dtype: StateDtype,
    fill: StateFill,
    index: usize,
    input_name: String,
    key: String,
    module: String,
    shape: Vec<usize>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum StateDtype {
    Bool,
    Float32,
    Int64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum StateFill {
    Empty,
    Nan,
    Ones,
    Zeros,
}

enum StateTensor {
    Bool(ArrayD<bool>),
    Float32(ArrayD<f32>),
    Int64(ArrayD<i64>),
}

struct ModelPaths {
    bundle: PathBuf,
    tokenizer: PathBuf,
    text_conditioner: PathBuf,
    flow_main: PathBuf,
    flow: PathBuf,
    decoder: PathBuf,
}

struct PocketTtsModel {
    config: BundleConfig,
    tokenizer: SentencePieceProcessor,
    text_conditioner: Session,
    flow_main: Session,
    flow: Session,
    decoder: Session,
    random: XorShift64,
}

impl PocketTtsModel {
    fn load(primary_path: &Path) -> Result<Self, SynthesisError> {
        validate_model_path(primary_path)
            .map_err(|error| SynthesisError::invalid_model(error.to_string()))?;
        let paths = resolve_paths(primary_path)?;
        let config_bytes = fs::read(&paths.bundle)
            .map_err(|error| SynthesisError::invalid_model(format!("bundle.json: {error}")))?;
        let config: BundleConfig = serde_json::from_slice(&config_bytes)
            .map_err(|error| SynthesisError::invalid_model(format!("bundle.json: {error}")))?;
        validate_config(&config)?;
        let tokenizer = SentencePieceProcessor::open(&paths.tokenizer)
            .map_err(|error| SynthesisError::invalid_model(format!("tokenizer.model: {error}")))?;
        let text_conditioner = build_session(&paths.text_conditioner)?;
        let flow_main = build_session(&paths.flow_main)?;
        let flow = build_session(&paths.flow)?;
        let decoder = build_session(&paths.decoder)?;
        verify_io(
            &text_conditioner,
            "text conditioner",
            &["token_ids"],
            &["embeddings"],
        )?;
        verify_state_graph(
            &flow_main,
            "flow LM",
            &["sequence", "text_embeddings"],
            &config.flow_lm_state_manifest,
            2,
        )?;
        verify_io(&flow, "flow", &["c", "s", "t", "x"], &["flow_dir"])?;
        verify_state_graph(
            &decoder,
            "Mimi decoder",
            &["latent"],
            &config.mimi_state_manifest,
            1,
        )?;

        Ok(Self {
            config,
            tokenizer,
            text_conditioner,
            flow_main,
            flow,
            decoder,
            random: XorShift64::seeded(),
        })
    }

    fn prepare_text(&self, text: &str) -> Result<(String, usize), SynthesisError> {
        let mut prepared = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if prepared.is_empty() {
            return Err(SynthesisError::invalid_request(
                "Synthesis text cannot be empty.",
            ));
        }
        if self.config.remove_semicolons {
            prepared = prepared.replace(';', ",");
        }
        let words = prepared.split_whitespace().count();
        let frames_after_eos = if words <= 4 { 5 } else { 3 };
        if let Some(first) = prepared.get_mut(0..1) {
            first.make_ascii_uppercase();
        }
        if prepared.chars().last().is_some_and(char::is_alphanumeric) {
            prepared.push('.');
        }
        if self.config.pad_with_spaces_for_short_inputs && words < 5 {
            prepared.insert_str(0, "        ");
        }
        Ok((
            prepared,
            self.config
                .model_recommended_frames_after_eos
                .unwrap_or(frames_after_eos),
        ))
    }

    fn generate_chunk(
        &mut self,
        text: &str,
        voice_path: &Path,
        cancellation: &SynthesisCancellation,
    ) -> Result<Vec<f32>, SynthesisError> {
        let (prepared, frames_after_eos) = self.prepare_text(text)?;
        let token_ids = self
            .tokenizer
            .encode_to_ids(&prepared)
            .map_err(|error| SynthesisError::inference("Pocket TTS tokenization", error))?
            .into_iter()
            .map(|id| id as i64)
            .collect::<Vec<_>>();
        if token_ids.is_empty() {
            return Err(SynthesisError::invalid_request(
                "Synthesis text produced no tokens.",
            ));
        }
        let token_count = token_ids.len();
        let voice_state = load_voice_state(voice_path, &self.config.flow_lm_state_manifest)?;
        let mut flow_state = state_values(&voice_state)?;
        let token_value = dyn_value_i64(&[1, token_count], token_ids)?;
        let text_outputs = run_named(
            &mut self.text_conditioner,
            vec![("token_ids".to_string(), token_value)],
            "text conditioner",
        )?;
        let text_embeddings = take_output(text_outputs, 0, "text_embeddings")?;
        let empty_sequence = dyn_value_f32(&[1, 0, self.config.latent_dim], Vec::new())?;
        let outputs = run_with_state(
            &mut self.flow_main,
            vec![
                ("sequence".to_string(), empty_sequence),
                ("text_embeddings".to_string(), text_embeddings),
            ],
            flow_state,
            "flow LM text conditioning",
        )?;
        flow_state = output_state(outputs, 2, self.config.flow_lm_state_manifest.len())?;

        let mut current = vec![f32::NAN; self.config.latent_dim];
        let max_frames = (((token_count as f32 / TOKENS_PER_SECOND) + GENERATION_PADDING_SECONDS)
            * self.config.frame_rate)
            .ceil() as usize;
        let mut eos_step = None;
        let mut latents = Vec::new();
        for step in 0..max_frames {
            if cancellation.is_cancelled() {
                return Err(SynthesisError::cancelled());
            }
            let outputs = run_with_state(
                &mut self.flow_main,
                vec![
                    (
                        "sequence".to_string(),
                        dyn_value_f32(&[1, 1, self.config.latent_dim], current)?,
                    ),
                    (
                        "text_embeddings".to_string(),
                        dyn_value_f32(&[1, 0, self.config.conditioning_dim], Vec::new())?,
                    ),
                ],
                flow_state,
                "flow LM generation",
            )?;
            let mut values = outputs.into_iter().map(|(_, value)| value);
            let conditioning = values.next().ok_or_else(|| {
                SynthesisError::invalid_model("flow LM omitted conditioning output")
            })?;
            let eos = values
                .next()
                .ok_or_else(|| SynthesisError::invalid_model("flow LM omitted EOS output"))?;
            let eos_logit = extract_f32(&eos, "EOS logit")?
                .first()
                .copied()
                .ok_or_else(|| {
                    SynthesisError::invalid_model("flow LM returned an empty EOS logit")
                })?;
            flow_state = values.collect();
            if eos_logit > -4.0 && eos_step.is_none() {
                eos_step = Some(step);
            }
            if eos_step.is_some_and(|eos| step >= eos + frames_after_eos) {
                break;
            }
            let mut noise = (0..self.config.latent_dim)
                .map(|_| self.random.normal() * 0.3_f32.sqrt())
                .collect::<Vec<_>>();
            let flow_outputs = run_named(
                &mut self.flow,
                vec![
                    ("c".to_string(), conditioning),
                    ("s".to_string(), dyn_value_f32(&[1, 1], vec![0.0])?),
                    ("t".to_string(), dyn_value_f32(&[1, 1], vec![1.0])?),
                    (
                        "x".to_string(),
                        dyn_value_f32(&[1, self.config.latent_dim], noise.clone())?,
                    ),
                ],
                "flow matching",
            )?;
            let flow = extract_f32(&take_output(flow_outputs, 0, "flow")?, "flow")?;
            if flow.len() != noise.len() {
                return Err(SynthesisError::invalid_model(
                    "flow output dimension mismatch",
                ));
            }
            for (value, delta) in noise.iter_mut().zip(flow) {
                *value += delta;
            }
            current = noise.clone();
            latents.extend(noise);
        }
        self.decode_latents(&latents, cancellation)
    }

    fn decode_latents(
        &mut self,
        latents: &[f32],
        cancellation: &SynthesisCancellation,
    ) -> Result<Vec<f32>, SynthesisError> {
        let state = initial_state(&self.config.mimi_state_manifest)?;
        let mut decoder_state = state_values(&state)?;
        let frame_count = latents.len() / self.config.latent_dim;
        let mut audio = Vec::with_capacity(frame_count * self.config.samples_per_frame);
        for start in (0..frame_count).step_by(LATENT_DECODE_CHUNK) {
            if cancellation.is_cancelled() {
                return Err(SynthesisError::cancelled());
            }
            let count = (frame_count - start).min(LATENT_DECODE_CHUNK);
            let from = start * self.config.latent_dim;
            let to = (start + count) * self.config.latent_dim;
            let outputs = run_with_state(
                &mut self.decoder,
                vec![(
                    "latent".to_string(),
                    dyn_value_f32(
                        &[1, count, self.config.latent_dim],
                        latents[from..to].to_vec(),
                    )?,
                )],
                decoder_state,
                "Mimi decoding",
            )?;
            let mut values = outputs.into_iter().map(|(_, value)| value);
            let pcm = values.next().ok_or_else(|| {
                SynthesisError::invalid_model("Mimi decoder omitted audio output")
            })?;
            audio.extend(extract_f32(&pcm, "Mimi audio")?);
            decoder_state = values.collect();
        }
        Ok(audio)
    }
}

impl SynthesisModel for PocketTtsModel {
    fn synthesize(
        &mut self,
        text: &str,
        _language: &str,
        voice_path: &Path,
        cancellation: &SynthesisCancellation,
    ) -> Result<SynthesisPcm, SynthesisError> {
        Ok(SynthesisPcm {
            samples: self.generate_chunk(text, voice_path, cancellation)?,
            sample_rate: self.config.sample_rate,
        })
    }
}

fn resolve_paths(primary_path: &Path) -> Result<ModelPaths, SynthesisError> {
    if primary_path.file_name().and_then(|name| name.to_str()) != Some("flow_lm_main_int8.onnx") {
        return Err(SynthesisError::invalid_model(
            "Pocket TTS must be selected through flow_lm_main_int8.onnx",
        ));
    }
    let dir = primary_path.parent().ok_or_else(|| {
        SynthesisError::invalid_model("Pocket TTS model directory could not be resolved")
    })?;
    let paths = ModelPaths {
        bundle: dir.join("bundle.json"),
        tokenizer: dir.join("tokenizer.model"),
        text_conditioner: dir.join("text_conditioner.onnx"),
        flow_main: primary_path.to_path_buf(),
        flow: dir.join("flow_lm_flow_int8.onnx"),
        decoder: dir.join("mimi_decoder_int8.onnx"),
    };
    for path in [
        &paths.bundle,
        &paths.tokenizer,
        &paths.text_conditioner,
        &paths.flow_main,
        &paths.flow,
        &paths.decoder,
    ] {
        if !path.is_file() {
            return Err(SynthesisError::invalid_model(format!(
                "required Pocket TTS artifact is missing: {}",
                path.display()
            )));
        }
    }
    Ok(paths)
}

fn validate_config(config: &BundleConfig) -> Result<(), SynthesisError> {
    if config.sample_rate != SAMPLE_RATE
        || config.latent_dim != 32
        || config.conditioning_dim == 0
        || config.frame_rate <= 0.0
        || config.samples_per_frame == 0
        || config.tokenizer_file != "tokenizer.model"
    {
        return Err(SynthesisError::invalid_model(
            "bundle.json contains an unsupported Pocket TTS audio or latent contract",
        ));
    }
    validate_manifest(&config.flow_lm_state_manifest, "flow LM")?;
    validate_manifest(&config.mimi_state_manifest, "Mimi decoder")
}

fn validate_manifest(manifest: &[StateEntry], name: &str) -> Result<(), SynthesisError> {
    if manifest.is_empty() {
        return Err(SynthesisError::invalid_model(format!(
            "{name} state manifest is empty"
        )));
    }
    for (expected, entry) in manifest.iter().enumerate() {
        if entry.index != expected || entry.input_name != format!("state_{expected}") {
            return Err(SynthesisError::invalid_model(format!(
                "{name} state manifest is not contiguous at index {expected}"
            )));
        }
    }
    Ok(())
}

fn build_session(path: &Path) -> Result<Session, SynthesisError> {
    let builder = Session::builder()
        .map_err(|error| SynthesisError::invalid_model(format!("{}: {error}", path.display())))?;
    let builder = builder
        .with_intra_threads(2)
        .map_err(|error| SynthesisError::invalid_model(format!("{}: {error}", path.display())))?;
    let mut builder = builder
        .with_inter_threads(1)
        .map_err(|error| SynthesisError::invalid_model(format!("{}: {error}", path.display())))?;
    builder
        .commit_from_file(path)
        .map_err(|error| SynthesisError::invalid_model(format!("{}: {error}", path.display())))
}

fn verify_io(
    session: &Session,
    graph: &str,
    expected_inputs: &[&str],
    expected_outputs: &[&str],
) -> Result<(), SynthesisError> {
    let inputs = session
        .inputs()
        .iter()
        .map(|input| input.name())
        .collect::<Vec<_>>();
    let outputs = session
        .outputs()
        .iter()
        .map(|output| output.name())
        .collect::<Vec<_>>();
    if inputs != expected_inputs || outputs != expected_outputs {
        return Err(SynthesisError::invalid_model(format!(
            "{graph} I/O mismatch: inputs={inputs:?}, outputs={outputs:?}"
        )));
    }
    Ok(())
}

fn verify_state_graph(
    session: &Session,
    graph: &str,
    prefix_inputs: &[&str],
    manifest: &[StateEntry],
    prefix_outputs: usize,
) -> Result<(), SynthesisError> {
    let mut inputs = prefix_inputs
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    inputs.extend(manifest.iter().map(|entry| entry.input_name.clone()));
    let actual_inputs = session
        .inputs()
        .iter()
        .map(|input| input.name())
        .collect::<Vec<_>>();
    if actual_inputs != inputs.iter().map(String::as_str).collect::<Vec<_>>()
        || session.outputs().len() != prefix_outputs + manifest.len()
    {
        return Err(SynthesisError::invalid_model(format!(
            "{graph} state I/O mismatch"
        )));
    }
    Ok(())
}

fn load_voice_state(
    path: &Path,
    manifest: &[StateEntry],
) -> Result<Vec<StateTensor>, SynthesisError> {
    let bytes = fs::read(path)
        .map_err(|error| SynthesisError::invalid_model(format!("{}: {error}", path.display())))?;
    let tensors = SafeTensors::deserialize(&bytes)
        .map_err(|error| SynthesisError::invalid_model(format!("{}: {error}", path.display())))?;
    let mut result = Vec::with_capacity(manifest.len());
    for entry in manifest {
        let key = format!("{}/{}", entry.module, entry.key);
        let derived_key = (entry.key == "step").then(|| format!("{}/offset", entry.module));
        let source = tensors.tensor(&key).ok().or_else(|| {
            derived_key
                .as_deref()
                .and_then(|key| tensors.tensor(key).ok())
        });
        let tensor = match source {
            Some(source) => adapt_tensor(source.dtype(), source.shape(), source.data(), entry)?,
            None => filled_state(entry)?,
        };
        result.push(tensor);
    }
    Ok(result)
}

fn adapt_tensor(
    dtype: Dtype,
    source_shape: &[usize],
    bytes: &[u8],
    entry: &StateEntry,
) -> Result<StateTensor, SynthesisError> {
    match (entry.dtype, dtype) {
        (StateDtype::Float32, Dtype::F32) => {
            let source = bytes
                .chunks_exact(4)
                .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("four-byte chunk")))
                .collect::<Vec<_>>();
            let target_len = element_count(&entry.shape);
            let data = if source.len() == target_len {
                source
            } else if source_shape.len() == entry.shape.len() {
                copy_tensor_prefix(&source, source_shape, &entry.shape, entry.fill)
            } else {
                filled_f32(target_len, entry.fill)
            };
            Ok(StateTensor::Float32(
                ArrayD::from_shape_vec(IxDyn(&entry.shape), data)
                    .map_err(|error| SynthesisError::invalid_model(error.to_string()))?,
            ))
        }
        (StateDtype::Int64, Dtype::I64) => {
            let mut source = bytes
                .chunks_exact(8)
                .map(|chunk| i64::from_le_bytes(chunk.try_into().expect("eight-byte chunk")))
                .collect::<Vec<_>>();
            source.resize(element_count(&entry.shape), 0);
            source.truncate(element_count(&entry.shape));
            Ok(StateTensor::Int64(
                ArrayD::from_shape_vec(IxDyn(&entry.shape), source)
                    .map_err(|error| SynthesisError::invalid_model(error.to_string()))?,
            ))
        }
        (StateDtype::Bool, Dtype::BOOL) => {
            let mut source = bytes.iter().map(|value| *value != 0).collect::<Vec<_>>();
            source.resize(element_count(&entry.shape), false);
            source.truncate(element_count(&entry.shape));
            Ok(StateTensor::Bool(
                ArrayD::from_shape_vec(IxDyn(&entry.shape), source)
                    .map_err(|error| SynthesisError::invalid_model(error.to_string()))?,
            ))
        }
        _ => Err(SynthesisError::invalid_model(format!(
            "voice state dtype mismatch for {}/{}: expected {:?}, found {dtype:?}",
            entry.module, entry.key, entry.dtype
        ))),
    }
}

fn copy_tensor_prefix(
    source: &[f32],
    source_shape: &[usize],
    target_shape: &[usize],
    fill: StateFill,
) -> Vec<f32> {
    let mut target = filled_f32(element_count(target_shape), fill);
    let dimensions = source_shape.len();
    let copy_shape = source_shape
        .iter()
        .zip(target_shape)
        .map(|(source, target)| (*source).min(*target))
        .collect::<Vec<_>>();
    for linear in 0..element_count(&copy_shape) {
        let mut remainder = linear;
        let mut source_index = 0;
        let mut target_index = 0;
        for dimension in (0..dimensions).rev() {
            let coordinate = remainder % copy_shape[dimension].max(1);
            remainder /= copy_shape[dimension].max(1);
            source_index += coordinate * source_shape[dimension + 1..].iter().product::<usize>();
            target_index += coordinate * target_shape[dimension + 1..].iter().product::<usize>();
        }
        if let (Some(source), Some(target)) =
            (source.get(source_index), target.get_mut(target_index))
        {
            *target = *source;
        }
    }
    target
}

fn initial_state(manifest: &[StateEntry]) -> Result<Vec<StateTensor>, SynthesisError> {
    manifest.iter().map(filled_state).collect()
}

fn filled_state(entry: &StateEntry) -> Result<StateTensor, SynthesisError> {
    let length = element_count(&entry.shape);
    match entry.dtype {
        StateDtype::Bool => Ok(StateTensor::Bool(
            ArrayD::from_shape_vec(
                IxDyn(&entry.shape),
                vec![matches!(entry.fill, StateFill::Ones); length],
            )
            .map_err(|error| SynthesisError::invalid_model(error.to_string()))?,
        )),
        StateDtype::Float32 => Ok(StateTensor::Float32(
            ArrayD::from_shape_vec(IxDyn(&entry.shape), filled_f32(length, entry.fill))
                .map_err(|error| SynthesisError::invalid_model(error.to_string()))?,
        )),
        StateDtype::Int64 => Ok(StateTensor::Int64(
            ArrayD::from_shape_vec(
                IxDyn(&entry.shape),
                vec![i64::from(matches!(entry.fill, StateFill::Ones)); length],
            )
            .map_err(|error| SynthesisError::invalid_model(error.to_string()))?,
        )),
    }
}

fn filled_f32(length: usize, fill: StateFill) -> Vec<f32> {
    vec![
        match fill {
            StateFill::Nan => f32::NAN,
            StateFill::Ones => 1.0,
            StateFill::Empty | StateFill::Zeros => 0.0,
        };
        length
    ]
}

fn element_count(shape: &[usize]) -> usize {
    shape.iter().copied().product()
}

fn state_values(state: &[StateTensor]) -> Result<Vec<DynValue>, SynthesisError> {
    state
        .iter()
        .map(|tensor| {
            let value = match tensor {
                StateTensor::Bool(array) => Value::from_array(array.clone()).map(DynValue::from),
                StateTensor::Float32(array) => Value::from_array(array.clone()).map(DynValue::from),
                StateTensor::Int64(array) => Value::from_array(array.clone()).map(DynValue::from),
            };
            value.map_err(|error| SynthesisError::inference("state tensor", error))
        })
        .collect()
}

type NamedInput = (Cow<'static, str>, SessionInputValue<'static>);

fn run_named<'session>(
    session: &'session mut Session,
    inputs: Vec<(String, DynValue)>,
    operation: &str,
) -> Result<ort::session::SessionOutputs<'session>, SynthesisError> {
    let inputs = inputs
        .into_iter()
        .map(|(name, value)| (Cow::Owned(name), value.into()))
        .collect::<Vec<NamedInput>>();
    session
        .run(inputs)
        .map_err(|error| SynthesisError::inference(operation, error))
}

fn run_with_state<'session>(
    session: &'session mut Session,
    mut inputs: Vec<(String, DynValue)>,
    state: Vec<DynValue>,
    operation: &str,
) -> Result<ort::session::SessionOutputs<'session>, SynthesisError> {
    inputs.extend(
        state
            .into_iter()
            .enumerate()
            .map(|(index, value)| (format!("state_{index}"), value)),
    );
    run_named(session, inputs, operation)
}

fn output_state(
    outputs: ort::session::SessionOutputs<'_>,
    offset: usize,
    count: usize,
) -> Result<Vec<DynValue>, SynthesisError> {
    let state = outputs
        .into_iter()
        .skip(offset)
        .map(|(_, value)| value)
        .collect::<Vec<_>>();
    if state.len() != count {
        return Err(SynthesisError::invalid_model("state output count mismatch"));
    }
    Ok(state)
}

fn take_output(
    outputs: ort::session::SessionOutputs<'_>,
    index: usize,
    name: &str,
) -> Result<DynValue, SynthesisError> {
    outputs
        .into_iter()
        .nth(index)
        .map(|(_, value)| value)
        .ok_or_else(|| SynthesisError::invalid_model(format!("graph omitted {name}")))
}

fn extract_f32(value: &DynValue, name: &str) -> Result<Vec<f32>, SynthesisError> {
    value
        .try_extract_tensor::<f32>()
        .map(|(_, data)| data.to_vec())
        .map_err(|error| SynthesisError::invalid_model(format!("{name}: {error}")))
}

fn dyn_value_f32(shape: &[usize], data: Vec<f32>) -> Result<DynValue, SynthesisError> {
    Value::from_array(
        ArrayD::from_shape_vec(IxDyn(shape), data)
            .map_err(|error| SynthesisError::inference("float tensor shape", error))?,
    )
    .map(DynValue::from)
    .map_err(|error| SynthesisError::inference("float tensor", error))
}

fn dyn_value_i64(shape: &[usize], data: Vec<i64>) -> Result<DynValue, SynthesisError> {
    Value::from_array(
        ArrayD::from_shape_vec(IxDyn(shape), data)
            .map_err(|error| SynthesisError::inference("integer tensor shape", error))?,
    )
    .map(DynValue::from)
    .map_err(|error| SynthesisError::inference("integer tensor", error))
}

struct XorShift64(u64);

impl XorShift64 {
    fn seeded() -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(0x9e37_79b9_7f4a_7c15);
        Self(seed.max(1))
    }

    fn uniform(&mut self) -> f32 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.0 = value;
        ((value >> 40) as f32 + 1.0) / ((1_u32 << 24) as f32 + 1.0)
    }

    fn normal(&mut self) -> f32 {
        let radius = (-2.0 * self.uniform().ln()).sqrt();
        radius * (std::f32::consts::TAU * self.uniform()).cos()
    }
}

#[cfg(test)]
mod tests {
    use super::{StateDtype, StateEntry, StateFill, initial_state};

    #[test]
    fn manifest_state_supports_zero_length_dimensions() {
        let state = initial_state(&[StateEntry {
            dtype: StateDtype::Float32,
            fill: StateFill::Empty,
            index: 0,
            input_name: "state_0".to_string(),
            key: "current_end".to_string(),
            module: "layer".to_string(),
            shape: vec![0],
        }])
        .expect("state should initialize");
        assert_eq!(state.len(), 1);
    }
}
