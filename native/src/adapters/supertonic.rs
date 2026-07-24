#![cfg(feature = "engine-supertonic")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use ndarray::{ArrayD, IxDyn};
use ort::session::{Session, SessionInputValue};
use ort::value::{DynValue, Value};
use regex::Regex;
use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;

use crate::engine::capabilities::{
    LanguageSupport, ModelFamilyCapabilities, ModelFamilyId, ModelTask, RuntimeId,
};
use crate::engine::traits::{LoadedModel, ModelFamilyAdapter};
use crate::synthesis::{SynthesisCancellation, SynthesisError, SynthesisModel, SynthesisPcm};
use crate::transcription::{GpuConfig, TranscriptionError, validate_model_path};

const SAMPLE_RATE: u32 = 44_100;
const DEFAULT_TOTAL_STEPS: usize = 8;
const SUPPORTED_LANGUAGES: [&str; 8] = ["en", "es", "de", "fr", "pt", "it", "nl", "ja"];

static EMOJI_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"[\x{1F600}-\x{1F64F}\x{1F300}-\x{1F5FF}\x{1F680}-\x{1F6FF}\x{1F700}-\x{1F77F}\x{1F780}-\x{1F7FF}\x{1F800}-\x{1F8FF}\x{1F900}-\x{1F9FF}\x{1FA00}-\x{1FA6F}\x{1FA70}-\x{1FAFF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{1F1E6}-\x{1F1FF}]+",
    )
    .expect("Supertonic emoji pattern must compile")
});
static WHITESPACE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+").expect("Supertonic whitespace pattern must compile"));

static CAPABILITIES: LazyLock<ModelFamilyCapabilities> =
    LazyLock::new(|| ModelFamilyCapabilities {
        task: ModelTask::Tts,
        available_voices: ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        supports_speed_control: true,
        output_sample_rate: Some(SAMPLE_RATE),
        supports_segment_timestamps: false,
        supports_word_timestamps: false,
        supports_initial_prompt: false,
        supports_streaming: true,
        supports_language_selection: true,
        supports_automatic_language_detection: false,
        supported_languages: LanguageSupport::List {
            tags: SUPPORTED_LANGUAGES
                .into_iter()
                .map(str::to_string)
                .collect(),
        },
        max_audio_duration_secs: None,
        produces_punctuation: false,
    });

pub struct SupertonicAdapter;

impl ModelFamilyAdapter for SupertonicAdapter {
    fn runtime_id(&self) -> RuntimeId {
        RuntimeId::OnnxRuntime
    }
    fn family_id(&self) -> ModelFamilyId {
        ModelFamilyId::Supertonic
    }
    fn capabilities(&self) -> &ModelFamilyCapabilities {
        &CAPABILITIES
    }
    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError> {
        SupertonicModel::load(path)
            .map(|_| ())
            .map_err(|e| TranscriptionError::invalid_model_with_details(e.to_string()))
    }
    fn load(
        &self,
        _path: &Path,
        _gpu: GpuConfig,
    ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
        Err(TranscriptionError::unsupported_engine(
            "Supertonic is available only through the synthesis path.".to_string(),
        ))
    }
    fn load_synthesis(&self, path: &Path) -> Result<Box<dyn SynthesisModel>, SynthesisError> {
        Ok(Box::new(SupertonicModel::load(path)?))
    }
}

#[derive(Deserialize)]
struct Config {
    ae: AeConfig,
    ttl: TtlConfig,
}
#[derive(Deserialize)]
struct AeConfig {
    sample_rate: u32,
    base_chunk_size: i64,
}
#[derive(Deserialize)]
struct TtlConfig {
    chunk_compress_factor: i64,
    latent_dim: i64,
}

struct ModelPaths {
    config: PathBuf,
    indexer: PathBuf,
    duration: PathBuf,
    text_encoder: PathBuf,
    vector: PathBuf,
    vocoder: PathBuf,
}

struct SupertonicModel {
    config: Config,
    indexer: Vec<i64>,
    duration: Session,
    text_encoder: Session,
    vector: Session,
    vocoder: Session,
    random: XorShift64,
}

impl SupertonicModel {
    fn load(primary_path: &Path) -> Result<Self, SynthesisError> {
        validate_model_path(primary_path)
            .map_err(|e| SynthesisError::invalid_model(e.to_string()))?;
        let paths = resolve_paths(primary_path)?;
        let config: Config = serde_json::from_slice(
            &fs::read(&paths.config)
                .map_err(|e| SynthesisError::invalid_model(format!("tts.json: {e}")))?,
        )
        .map_err(|e| SynthesisError::invalid_model(format!("tts.json: {e}")))?;
        if config.ae.sample_rate != SAMPLE_RATE
            || config.ae.base_chunk_size <= 0
            || config.ttl.chunk_compress_factor <= 0
            || config.ttl.latent_dim <= 0
        {
            return Err(SynthesisError::invalid_model(
                "Supertonic tts.json contains an unsupported audio or latent contract",
            ));
        }
        let indexer: Vec<i64> =
            serde_json::from_slice(&fs::read(&paths.indexer).map_err(|e| {
                SynthesisError::invalid_model(format!("unicode_indexer.json: {e}"))
            })?)
            .map_err(|e| SynthesisError::invalid_model(format!("unicode_indexer.json: {e}")))?;
        let model = Self {
            config,
            indexer,
            duration: build_session(&paths.duration)?,
            text_encoder: build_session(&paths.text_encoder)?,
            vector: build_session(&paths.vector)?,
            vocoder: build_session(&paths.vocoder)?,
            random: XorShift64::seeded(),
        };
        verify_io(
            &model.duration,
            "duration predictor",
            &["text_ids", "style_dp", "text_mask"],
            &["duration"],
        )?;
        verify_io(
            &model.text_encoder,
            "text encoder",
            &["text_ids", "style_ttl", "text_mask"],
            &["text_emb"],
        )?;
        verify_io(
            &model.vector,
            "vector estimator",
            &[
                "noisy_latent",
                "text_emb",
                "style_ttl",
                "text_mask",
                "latent_mask",
                "current_step",
                "total_step",
            ],
            &["denoised_latent"],
        )?;
        verify_io(&model.vocoder, "vocoder", &["latent"], &["wav_tts"])?;
        Ok(model)
    }

    fn text_id_data(
        &self,
        text: &str,
        language: &str,
    ) -> Result<(Vec<i64>, usize), SynthesisError> {
        let prepared = preprocess_text(text, language)?;
        let mut ids = Vec::with_capacity(prepared.chars().count());
        for ch in prepared.chars() {
            let ord = ch as usize;
            let id = *self.indexer.get(ord).ok_or_else(|| {
                SynthesisError::invalid_request(format!(
                    "Supertonic does not support character U+{ord:04X}."
                ))
            })?;
            if id < 0 {
                return Err(SynthesisError::invalid_request(format!(
                    "Supertonic does not support character '{ch}'."
                )));
            }
            ids.push(id);
        }
        let len = ids.len();
        Ok((ids, len))
    }

    fn synthesize_inner(
        &mut self,
        text: &str,
        language: &str,
        voice_path: &Path,
        cancellation: &SynthesisCancellation,
    ) -> Result<Vec<f32>, SynthesisError> {
        let style = load_style(voice_path)?;
        let (text_id_data, text_id_len) = self.text_id_data(text, language)?;
        let text_mask_data = vec![1.0_f32; text_id_len];
        let dp = run(
            &mut self.duration,
            vec![
                (
                    "text_ids",
                    dyn_i64(&[1, text_id_len], text_id_data.clone())?,
                ),
                ("style_dp", style.dp.value()?),
                (
                    "text_mask",
                    dyn_f32(&[1, 1, text_id_len], text_mask_data.clone())?,
                ),
            ],
            "duration predictor",
        )?;
        let duration = extract_f32(&take_output(dp, "duration")?, "duration")?;
        if duration.is_empty() {
            return Err(SynthesisError::invalid_model(
                "Supertonic duration predictor returned no duration",
            ));
        }
        let text_emb_value = run(
            &mut self.text_encoder,
            vec![
                (
                    "text_ids",
                    dyn_i64(&[1, text_id_len], text_id_data.clone())?,
                ),
                ("style_ttl", style.ttl.value()?),
                (
                    "text_mask",
                    dyn_f32(&[1, 1, text_id_len], text_mask_data.clone())?,
                ),
            ],
            "text encoder",
        )?;
        let text_emb_value = take_output(text_emb_value, "text_emb")?;
        let text_emb = extract_tensor(&text_emb_value, "text embedding")?;
        let (mut xt, latent_mask) = sample_latent(&duration, &self.config, &mut self.random)?;
        for step in 0..DEFAULT_TOTAL_STEPS {
            if cancellation.is_cancelled() {
                return Err(SynthesisError::cancelled());
            }
            let outputs = run(
                &mut self.vector,
                vec![
                    ("noisy_latent", xt),
                    ("text_emb", text_emb.value()?),
                    ("style_ttl", style.ttl.value()?),
                    (
                        "text_mask",
                        dyn_f32(&[1, 1, text_id_len], text_mask_data.clone())?,
                    ),
                    ("latent_mask", latent_mask.value()?),
                    ("current_step", dyn_f32(&[1], vec![step as f32])?),
                    (
                        "total_step",
                        dyn_f32(&[1], vec![DEFAULT_TOTAL_STEPS as f32])?,
                    ),
                ],
                "vector estimator",
            )?;
            xt = take_output(outputs, "denoised_latent")?;
        }
        let wav = run(&mut self.vocoder, vec![("latent", xt)], "vocoder")?;
        let mut samples = extract_f32(&take_output(wav, "wav_tts")?, "vocoder audio")?;
        let expected_samples = (duration[0].max(0.0) * SAMPLE_RATE as f32).ceil() as usize;
        samples.truncate(expected_samples.min(samples.len()));
        Ok(samples)
    }
}

impl SynthesisModel for SupertonicModel {
    fn synthesize(
        &mut self,
        text: &str,
        language: &str,
        voice_path: &Path,
        cancellation: &SynthesisCancellation,
    ) -> Result<SynthesisPcm, SynthesisError> {
        Ok(SynthesisPcm {
            samples: self.synthesize_inner(text, language, voice_path, cancellation)?,
            sample_rate: SAMPLE_RATE,
        })
    }
}

struct Style {
    ttl: TensorData,
    dp: TensorData,
}
struct TensorData {
    shape: Vec<usize>,
    data: Vec<f32>,
}
impl TensorData {
    fn value(&self) -> Result<DynValue, SynthesisError> {
        dyn_f32(&self.shape, self.data.clone())
    }
}
#[derive(Deserialize)]
struct StyleJson {
    style_ttl: TensorJson,
    style_dp: TensorJson,
}
#[derive(Deserialize)]
struct TensorJson {
    data: serde_json::Value,
    dims: Vec<usize>,
}
fn load_style(path: &Path) -> Result<Style, SynthesisError> {
    let style: StyleJson = serde_json::from_slice(
        &fs::read(path)
            .map_err(|e| SynthesisError::invalid_model(format!("{}: {e}", path.display())))?,
    )
    .map_err(|e| SynthesisError::invalid_model(format!("{}: {e}", path.display())))?;
    Ok(Style {
        ttl: tensor_json(style.style_ttl)?,
        dp: tensor_json(style.style_dp)?,
    })
}
fn tensor_json(t: TensorJson) -> Result<TensorData, SynthesisError> {
    let mut out = Vec::new();
    flatten_numbers(&t.data, &mut out)?;
    Ok(TensorData {
        shape: t.dims,
        data: out,
    })
}
fn flatten_numbers(v: &serde_json::Value, out: &mut Vec<f32>) -> Result<(), SynthesisError> {
    match v {
        serde_json::Value::Array(a) => {
            for x in a {
                flatten_numbers(x, out)?;
            }
            Ok(())
        }
        serde_json::Value::Number(n) => {
            out.push(
                n.as_f64().ok_or_else(|| {
                    SynthesisError::invalid_model("invalid Supertonic style number")
                })? as f32,
            );
            Ok(())
        }
        _ => Err(SynthesisError::invalid_model(
            "invalid Supertonic style tensor",
        )),
    }
}

fn resolve_paths(primary: &Path) -> Result<ModelPaths, SynthesisError> {
    if primary.file_name().and_then(|n| n.to_str()) != Some("vector_estimator.onnx") {
        return Err(SynthesisError::invalid_model(
            "Supertonic must be selected through vector_estimator.onnx",
        ));
    }
    let onnx = primary.parent().ok_or_else(|| {
        SynthesisError::invalid_model("Supertonic model directory could not be resolved")
    })?;
    let p = ModelPaths {
        config: onnx.join("tts.json"),
        indexer: onnx.join("unicode_indexer.json"),
        duration: onnx.join("duration_predictor.onnx"),
        text_encoder: onnx.join("text_encoder.onnx"),
        vector: primary.to_path_buf(),
        vocoder: onnx.join("vocoder.onnx"),
    };
    for f in [
        &p.config,
        &p.indexer,
        &p.duration,
        &p.text_encoder,
        &p.vector,
        &p.vocoder,
    ] {
        if !f.is_file() {
            return Err(SynthesisError::invalid_model(format!(
                "required Supertonic artifact is missing: {}",
                f.display()
            )));
        }
    }
    Ok(p)
}
fn preprocess_text(text: &str, language: &str) -> Result<String, SynthesisError> {
    if language != "na" && !SUPPORTED_LANGUAGES.contains(&language) {
        return Err(SynthesisError::invalid_request(format!(
            "Supertonic does not support language '{language}'."
        )));
    }
    let mut prepared = text.nfkd().collect::<String>();
    prepared = EMOJI_PATTERN.replace_all(&prepared, "").into_owned();
    for (from, to) in [
        ("–", "-"),
        ("‑", "-"),
        ("—", "-"),
        ("_", " "),
        ("\u{201C}", "\""),
        ("\u{201D}", "\""),
        ("\u{2018}", "'"),
        ("\u{2019}", "'"),
        ("´", "'"),
        ("`", "'"),
        ("[", " "),
        ("]", " "),
        ("|", " "),
        ("/", " "),
        ("#", " "),
        ("→", " "),
        ("←", " "),
        ("♥", ""),
        ("☆", ""),
        ("♡", ""),
        ("©", ""),
        ("\\", ""),
        ("@", " at "),
        ("e.g.,", "for example, "),
        ("i.e.,", "that is, "),
    ] {
        prepared = prepared.replace(from, to);
    }
    for punctuation in [",", ".", "!", "?", ";", ":", "'"] {
        prepared = prepared.replace(&format!(" {punctuation}"), punctuation);
    }
    while prepared.contains("\"\"") {
        prepared = prepared.replace("\"\"", "\"");
    }
    while prepared.contains("''") {
        prepared = prepared.replace("''", "'");
    }
    prepared = WHITESPACE_PATTERN
        .replace_all(prepared.trim(), " ")
        .into_owned();
    if prepared.is_empty() {
        return Err(SynthesisError::invalid_request(
            "Synthesis text cannot be empty.",
        ));
    }
    if prepared
        .chars()
        .last()
        .is_none_or(|c| !".!?;:,'\"')]}…。」』】〉》›»".contains(c))
    {
        prepared.push('.');
    }
    Ok(format!("<{language}>{prepared}</{language}>"))
}
fn sample_latent(
    duration: &[f32],
    cfg: &Config,
    random: &mut XorShift64,
) -> Result<(DynValue, TensorData), SynthesisError> {
    let dur = duration[0].max(0.1);
    let chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
    let latent_len = (((dur * cfg.ae.sample_rate as f32) + chunk as f32 - 1.0) / chunk as f32)
        .floor()
        .max(1.0) as usize;
    let latent_dim = (cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor) as usize;
    let xt = (0..latent_dim * latent_len)
        .map(|_| random.normal())
        .collect();
    let mask = vec![1.0; latent_len];
    Ok((
        dyn_f32(&[1, latent_dim, latent_len], xt)?,
        TensorData {
            shape: vec![1, 1, latent_len],
            data: mask,
        },
    ))
}
fn build_session(path: &Path) -> Result<Session, SynthesisError> {
    Session::builder()
        .map_err(|e| SynthesisError::invalid_model(format!("{}: {e}", path.display())))?
        .with_intra_threads(2)
        .map_err(|e| SynthesisError::invalid_model(format!("{}: {e}", path.display())))?
        .with_inter_threads(1)
        .map_err(|e| SynthesisError::invalid_model(format!("{}: {e}", path.display())))?
        .commit_from_file(path)
        .map_err(|e| SynthesisError::invalid_model(format!("{}: {e}", path.display())))
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
        .map(|i| i.name())
        .collect::<Vec<_>>();
    let outputs = session
        .outputs()
        .iter()
        .map(|output| output.name())
        .collect::<Vec<_>>();
    let inputs_match = inputs.len() == expected_inputs.len()
        && expected_inputs
            .iter()
            .all(|expected| inputs.contains(expected));
    let outputs_match = outputs.len() == expected_outputs.len()
        && expected_outputs
            .iter()
            .all(|expected| outputs.contains(expected));
    if !inputs_match || !outputs_match {
        return Err(SynthesisError::invalid_model(format!(
            "{graph} I/O mismatch: inputs={inputs:?}, outputs={outputs:?}"
        )));
    }
    Ok(())
}
fn take_output(
    outputs: Vec<(String, DynValue)>,
    expected_name: &str,
) -> Result<DynValue, SynthesisError> {
    outputs
        .into_iter()
        .find_map(|(name, value)| (name == expected_name).then_some(value))
        .ok_or_else(|| {
            SynthesisError::invalid_model(format!("graph omitted {expected_name} output"))
        })
}
fn run(
    session: &mut Session,
    inputs: Vec<(&str, DynValue)>,
    graph: &str,
) -> Result<Vec<(String, DynValue)>, SynthesisError> {
    let named = inputs
        .into_iter()
        .map(|(k, v)| (k.to_string(), SessionInputValue::Owned(v)))
        .collect::<Vec<_>>();
    session
        .run(named)
        .map(|o| o.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
        .map_err(|e| SynthesisError::inference(graph, e))
}
fn dyn_f32(shape: &[usize], data: Vec<f32>) -> Result<DynValue, SynthesisError> {
    Ok(Value::from_array(
        ArrayD::from_shape_vec(IxDyn(shape), data)
            .map_err(|e| SynthesisError::invalid_model(e.to_string()))?,
    )
    .map_err(|e| SynthesisError::inference("Supertonic tensor creation", e))?
    .into_dyn())
}
fn dyn_i64(shape: &[usize], data: Vec<i64>) -> Result<DynValue, SynthesisError> {
    Ok(Value::from_array(
        ArrayD::from_shape_vec(IxDyn(shape), data)
            .map_err(|e| SynthesisError::invalid_model(e.to_string()))?,
    )
    .map_err(|e| SynthesisError::inference("Supertonic tensor creation", e))?
    .into_dyn())
}
fn extract_f32(value: &DynValue, label: &str) -> Result<Vec<f32>, SynthesisError> {
    let data = value
        .try_extract_array::<f32>()
        .map_err(|e| SynthesisError::invalid_model(format!("{label}: {e}")))?;
    Ok(data.iter().copied().collect())
}

fn extract_tensor(value: &DynValue, label: &str) -> Result<TensorData, SynthesisError> {
    let array = value
        .try_extract_array::<f32>()
        .map_err(|e| SynthesisError::invalid_model(format!("{label}: {e}")))?;
    Ok(TensorData {
        shape: array.shape().to_vec(),
        data: array.iter().copied().collect(),
    })
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
    use super::{AeConfig, Config, TtlConfig, XorShift64, preprocess_text, sample_latent};

    #[test]
    fn preprocessing_uses_the_explicit_language_and_normalizes_read_aloud_text() {
        assert_eq!(
            preprocess_text("  “Hello”  🌟 ", "en").expect("text should normalize"),
            "<en>\"Hello\"</en>"
        );
        assert!(preprocess_text("Hello", "zh").is_err());
    }

    #[test]
    fn latent_seed_uses_gaussian_noise_and_preserves_the_mask_shape() {
        let config = Config {
            ae: AeConfig {
                sample_rate: 44_100,
                base_chunk_size: 512,
            },
            ttl: TtlConfig {
                chunk_compress_factor: 6,
                latent_dim: 24,
            },
        };
        let mut random = XorShift64(1);
        let (latent, mask) =
            sample_latent(&[0.5], &config, &mut random).expect("latent should build");
        let latent = latent
            .try_extract_array::<f32>()
            .expect("latent should be float32");
        assert!(latent.iter().any(|value| value.abs() > f32::EPSILON));
        assert_eq!(mask.shape, vec![1, 1, 8]);
        assert_eq!(mask.data, vec![1.0; 8]);
    }
}
