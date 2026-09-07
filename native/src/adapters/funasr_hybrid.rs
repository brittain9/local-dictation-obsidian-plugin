//! Chinese live dictation with two deliberately different recognition passes.
//!
//! Paraformer emits low-latency revisions while the user is speaking. At an
//! utterance boundary, the official FunASR SenseVoiceSmall runtime transcribes
//! the full WAV and replaces the provisional text. That keeps a streaming
//! model's limited right context out of the text committed to the note.

use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::LazyLock;
use std::thread;
use std::time::{Duration, Instant};

use sherpa_onnx::{OnlineRecognizer, OnlineRecognizerConfig, OnlineStream};
use uuid::Uuid;

use crate::engine::capabilities::{
    AcceleratorId, LanguageSupport, ModelFamilyCapabilities, ModelFamilyId, ModelTask, RuntimeId,
};
use crate::engine::traits::{
    LoadedModel, ModelFamilyAdapter, StreamingModel, StreamingPartialCadence,
};
use crate::protocol::{TimestampGranularity, TimestampSource, TranscriptSegment};
use crate::runtimes::funasr::{
    audio_cpp_helper_path, audio_cpp_helper_supports_backend, nano_helper_path,
    nano_helper_supports_backend, sensevoice_helper_path,
};
use crate::transcription::{
    EngineTranscriptOutput, GpuConfig, SegmentDiagnostics, TranscriptionError, validate_model_path,
};

const SAMPLE_RATE: i32 = 16_000;
const FINAL_PASS_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const ONLINE_ENCODER_FILENAME: &str = "encoder.int8.onnx";
const ONLINE_DECODER_FILENAME: &str = "decoder.int8.onnx";
const ONLINE_TOKENS_FILENAME: &str = "tokens.txt";
const FINAL_MODEL_FILENAMES: &[&str] = &[
    "sensevoice-small-q8.gguf",
    "sensevoice-small-f16.gguf",
    "sensevoice-small-f32.gguf",
];
const NANO_ENCODER_FILENAME: &str = "funasr-encoder-f16.gguf";
const NANO_MODEL_FILENAMES: &[&str] = &[
    "qwen3-0.6b-q4km.gguf",
    "qwen3-0.6b-q5km.gguf",
    "qwen3-0.6b-q8_0.gguf",
];
const NANO_2512_MODEL_FILENAMES: &[&str] =
    &["fun-asr-nano-2512-q8_0.gguf", "fun-asr-nano-2512-f16.gguf"];
const FINAL_VAD_FILENAME: &str = "fsmn-vad.gguf";

static CAPABILITIES: LazyLock<ModelFamilyCapabilities> =
    LazyLock::new(|| ModelFamilyCapabilities {
        task: ModelTask::Stt,
        supports_hardware_acceleration: cfg!(target_os = "linux"),
        available_voices: Vec::new(),
        supports_speed_control: false,
        output_sample_rate: None,
        supports_segment_timestamps: true,
        supports_word_timestamps: false,
        supports_initial_prompt: false,
        supports_streaming: true,
        supports_language_selection: true,
        supports_automatic_language_detection: true,
        supported_languages: LanguageSupport::List {
            tags: ["zh", "yue", "en", "ja", "ko"]
                .into_iter()
                .map(str::to_string)
                .collect(),
        },
        max_audio_duration_secs: None,
        produces_punctuation: true,
    });

pub struct FunasrHybridAdapter;

impl ModelFamilyAdapter for FunasrHybridAdapter {
    fn runtime_id(&self) -> RuntimeId {
        RuntimeId::FunasrLlamaCpp
    }

    fn family_id(&self) -> ModelFamilyId {
        ModelFamilyId::FunasrHybrid
    }

    fn capabilities(&self) -> &ModelFamilyCapabilities {
        &CAPABILITIES
    }

    fn supports_accelerator_for_model(&self, path: &Path, accelerator: AcceleratorId) -> bool {
        if accelerator == AcceleratorId::Cpu {
            return true;
        }
        HybridModelPaths::from_entry(path)
            .map(|paths| match paths.final_model {
                FinalModelPaths::SenseVoice { .. } => accelerator == AcceleratorId::Vulkan,
                FinalModelPaths::Nano { .. } => {
                    accelerator == AcceleratorId::Vulkan
                        && nano_helper_supports_backend(accelerator)
                }
                FinalModelPaths::Nano2512 { .. } => {
                    accelerator == AcceleratorId::Vulkan
                        && audio_cpp_helper_supports_backend(accelerator)
                }
            })
            .unwrap_or(false)
    }

    fn probe_model(&self, path: &Path) -> Result<(), TranscriptionError> {
        let paths = HybridModelPaths::from_entry(path)?;
        paths.verify_final_models()?;
        let _recognizer = create_online_recognizer(&paths)?;
        paths.require_helper()?;
        Ok(())
    }

    fn probe_model_and_language_support(
        &self,
        path: &Path,
    ) -> Result<LanguageSupport, TranscriptionError> {
        self.probe_model(path)?;
        let paths = HybridModelPaths::from_entry(path)?;
        Ok(paths.final_model.language_support())
    }

    fn load(
        &self,
        _path: &Path,
        _gpu: GpuConfig,
    ) -> Result<Box<dyn LoadedModel>, TranscriptionError> {
        Err(TranscriptionError::unsupported_engine(
            "FunASR Chinese Hybrid is available only through live dictation.".to_string(),
        ))
    }

    fn load_streaming(
        &self,
        path: &Path,
        gpu: GpuConfig,
    ) -> Result<Box<dyn StreamingModel>, TranscriptionError> {
        let paths = HybridModelPaths::from_entry(path)?;
        paths.verify_final_models()?;
        let recognizer = create_online_recognizer(&paths)?;
        let helper = paths.require_helper()?;

        Ok(Box::new(LoadedFunasrHybridModel {
            helper,
            language: "auto".to_string(),
            online_stream: recognizer.create_stream(),
            recognizer,
            samples: Vec::new(),
            accelerator: gpu.accelerator,
            paths,
        }))
    }
}

struct HybridModelPaths {
    final_model: FinalModelPaths,
    final_vad: PathBuf,
    online_decoder: PathBuf,
    online_encoder: PathBuf,
    online_tokens: PathBuf,
}

enum FinalModelPaths {
    Nano { encoder: PathBuf, model: PathBuf },
    Nano2512 { model: PathBuf },
    SenseVoice { model: PathBuf },
}

impl FinalModelPaths {
    fn language_support(&self) -> LanguageSupport {
        let tags = match self {
            Self::Nano { .. } => &["zh", "en"][..],
            Self::Nano2512 { .. } => &["zh", "yue", "en", "ja"][..],
            Self::SenseVoice { .. } => &["zh", "yue", "en", "ja", "ko"][..],
        };
        LanguageSupport::List {
            tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
        }
    }
}

impl HybridModelPaths {
    fn from_entry(path: &Path) -> Result<Self, TranscriptionError> {
        validate_model_path(path)?;
        if path.file_name() != Some(OsStr::new(ONLINE_ENCODER_FILENAME)) {
            return Err(TranscriptionError::invalid_model_with_details(format!(
                "FunASR Chinese Hybrid must be selected through {ONLINE_ENCODER_FILENAME}; received {}",
                path.display()
            )));
        }

        let root = path.parent().ok_or_else(|| {
            TranscriptionError::invalid_model("cannot determine the FunASR model directory")
        })?;

        let sensevoice = find_one_of(root, FINAL_MODEL_FILENAMES)?;
        let nano = find_one_of(root, NANO_MODEL_FILENAMES)?;
        let nano_2512 = find_one_of(root, NANO_2512_MODEL_FILENAMES)?;
        let nano_encoder = root.join(NANO_ENCODER_FILENAME);
        let final_model = match (sensevoice, nano, nano_2512, nano_encoder.is_file()) {
            (Some(model), None, None, false) => FinalModelPaths::SenseVoice { model },
            (None, Some(model), None, true) => FinalModelPaths::Nano {
                encoder: required_file(root, NANO_ENCODER_FILENAME)?,
                model,
            },
            (None, None, Some(model), false) => FinalModelPaths::Nano2512 { model },
            _ => {
                return Err(TranscriptionError::invalid_model_with_details(
                    "FunASR Chinese Hybrid must contain exactly one complete SenseVoiceSmall or Fun-ASR Nano final model"
                        .to_string(),
                ));
            }
        };

        Ok(Self {
            final_model,
            final_vad: required_file(root, FINAL_VAD_FILENAME)?,
            online_decoder: required_file(root, ONLINE_DECODER_FILENAME)?,
            online_encoder: path.to_path_buf(),
            online_tokens: required_file(root, ONLINE_TOKENS_FILENAME)?,
        })
    }

    fn require_helper(&self) -> Result<PathBuf, TranscriptionError> {
        let (helper, name) = match &self.final_model {
            FinalModelPaths::Nano { .. } => (nano_helper_path(), "Fun-ASR Nano"),
            FinalModelPaths::Nano2512 { .. } => (audio_cpp_helper_path(), "Fun-ASR Nano 2512"),
            FinalModelPaths::SenseVoice { .. } => (sensevoice_helper_path(), "FunASR SenseVoice"),
        };
        helper.ok_or_else(|| {
            TranscriptionError::unsupported_engine(format!(
                "The packaged {name} runtime is missing beside the sidecar."
            ))
        })
    }

    fn verify_final_models(&self) -> Result<(), TranscriptionError> {
        match &self.final_model {
            FinalModelPaths::Nano { encoder, model } => {
                verify_gguf(encoder)?;
                verify_gguf(model)
            }
            FinalModelPaths::Nano2512 { model } => verify_gguf(model),
            FinalModelPaths::SenseVoice { model } => verify_gguf(model),
        }
    }
}

fn find_one_of(root: &Path, filenames: &[&str]) -> Result<Option<PathBuf>, TranscriptionError> {
    let matches = filenames
        .iter()
        .map(|filename| root.join(filename))
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    if matches.len() > 1 {
        return Err(TranscriptionError::invalid_model_with_details(format!(
            "FunASR Chinese Hybrid contains multiple final models ({})",
            filenames.join(", ")
        )));
    }
    if let Some(path) = matches.first() {
        validate_model_path(path)?;
    }
    Ok(matches.into_iter().next())
}

fn required_file(root: &Path, filename: &str) -> Result<PathBuf, TranscriptionError> {
    let path = root.join(filename);
    if !path.is_file() {
        return Err(TranscriptionError::invalid_model_with_details(format!(
            "required FunASR Chinese Hybrid asset missing: {}",
            path.display()
        )));
    }
    validate_model_path(&path)?;
    Ok(path)
}

fn verify_gguf(path: &Path) -> Result<(), TranscriptionError> {
    let mut header = [0_u8; 4];
    File::open(path)
        .and_then(|mut file| std::io::Read::read_exact(&mut file, &mut header))
        .map_err(|error| {
            TranscriptionError::invalid_model_with_details(format!(
                "failed to read FunASR SenseVoice GGUF header: {error}"
            ))
        })?;
    if &header != b"GGUF" {
        return Err(TranscriptionError::invalid_model(
            "FunASR SenseVoice final model is not a GGUF file",
        ));
    }
    Ok(())
}

fn create_online_recognizer(
    paths: &HybridModelPaths,
) -> Result<OnlineRecognizer, TranscriptionError> {
    let mut config = OnlineRecognizerConfig::default();
    config.model_config.paraformer.encoder = Some(paths.online_encoder.to_string_lossy().into());
    config.model_config.paraformer.decoder = Some(paths.online_decoder.to_string_lossy().into());
    config.model_config.tokens = Some(paths.online_tokens.to_string_lossy().into());
    config.model_config.num_threads = 4;
    config.decoding_method = Some("greedy_search".to_string());

    OnlineRecognizer::create(&config).ok_or_else(|| {
        TranscriptionError::invalid_model_with_details(
            "unable to load the FunASR Paraformer streaming model".to_string(),
        )
    })
}

struct LoadedFunasrHybridModel {
    helper: PathBuf,
    language: String,
    online_stream: OnlineStream,
    paths: HybridModelPaths,
    recognizer: OnlineRecognizer,
    samples: Vec<i16>,
    accelerator: Option<AcceleratorId>,
}

impl LoadedFunasrHybridModel {
    fn run_final_pass(&self) -> Result<String, TranscriptionError> {
        if self.samples.is_empty() {
            return Ok(String::new());
        }

        let wav = TemporaryWav::write(&self.samples)?;
        if matches!(&self.paths.final_model, FinalModelPaths::Nano { .. }) {
            let backend = nano_backend(self.accelerator);
            return self
                .run_nano_final_pass_with_backend(wav.path(), backend)
                .map_err(|error| TranscriptionError::transcription_failure("Fun-ASR Nano", error));
        }
        if matches!(&self.paths.final_model, FinalModelPaths::Nano2512 { .. }) {
            let backend = nano_backend(self.accelerator);
            return self
                .run_nano_2512_final_pass_with_backend(wav.path(), backend)
                .map_err(|error| {
                    TranscriptionError::transcription_failure("Fun-ASR Nano 2512", error)
                });
        }
        let backend = sensevoice_backend(self.accelerator);
        self.run_final_pass_with_backend(wav.path(), backend)
            .map_err(|error| TranscriptionError::transcription_failure("FunASR SenseVoice", error))
    }

    fn run_final_pass_with_backend(
        &self,
        wav_path: &Path,
        backend: &str,
    ) -> Result<String, String> {
        let FinalModelPaths::SenseVoice { model } = &self.paths.final_model else {
            return Err("SenseVoice final pass received a Fun-ASR Nano model".to_string());
        };
        let mut command = Command::new(&self.helper);
        command
            .arg("-m")
            .arg(model)
            .arg("--vad")
            .arg(&self.paths.final_vad)
            .arg("-a")
            .arg(wav_path)
            .arg("--backend")
            .arg(backend);
        let output = run_helper_with_timeout(
            &mut command,
            &format!("{backend} final pass"),
            FINAL_PASS_TIMEOUT,
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stderr_suffix = if stderr.is_empty() {
                String::new()
            } else {
                format!(": {stderr}")
            };
            return Err(format!(
                "{backend} final pass exited with {}{}",
                output.status, stderr_suffix,
            ));
        }

        Ok(parse_helper_output(&output.stdout))
    }

    fn run_nano_final_pass_with_backend(
        &self,
        wav_path: &Path,
        backend: &str,
    ) -> Result<String, String> {
        let FinalModelPaths::Nano { encoder, model } = &self.paths.final_model else {
            return Err("Fun-ASR Nano final pass received a SenseVoice model".to_string());
        };
        let mut command = Command::new(&self.helper);
        command
            .arg("--enc")
            .arg(encoder)
            .arg("-m")
            .arg(model)
            .arg("--vad")
            .arg(&self.paths.final_vad)
            .arg("-a")
            .arg(wav_path);
        command.arg("--backend").arg(backend);
        let output = run_helper_with_timeout(
            &mut command,
            &format!("{backend} Fun-ASR Nano final pass"),
            FINAL_PASS_TIMEOUT,
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!(
                "Fun-ASR Nano {backend} final pass exited with {}{}",
                output.status,
                if stderr.is_empty() {
                    String::new()
                } else {
                    format!(": {stderr}")
                }
            ));
        }
        Ok(parse_helper_output(&output.stdout))
    }

    fn run_nano_2512_final_pass_with_backend(
        &self,
        wav_path: &Path,
        backend: &str,
    ) -> Result<String, String> {
        let FinalModelPaths::Nano2512 { model } = &self.paths.final_model else {
            return Err("Fun-ASR Nano 2512 final pass received another model".to_string());
        };
        let transcript_path = wav_path.with_extension("txt");
        let transcript = (|| {
            let mut command = Command::new(&self.helper);
            command
                .arg("--task")
                .arg("asr")
                .arg("--family")
                .arg("fun_asr_nano")
                .arg("--model")
                .arg(model)
                .arg("--backend")
                .arg(backend)
                .arg("--language")
                .arg(nano_2512_language(&self.language))
                .arg("--audio")
                .arg(wav_path)
                .arg("--text-out")
                .arg(&transcript_path);
            let output = run_helper_with_timeout(
                &mut command,
                &format!("audio.cpp {backend} final pass"),
                FINAL_PASS_TIMEOUT,
            )?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(format!(
                    "audio.cpp {backend} final pass exited with {}{}",
                    output.status,
                    if stderr.is_empty() {
                        String::new()
                    } else {
                        format!(": {stderr}")
                    }
                ));
            }
            fs::read_to_string(&transcript_path)
                .map(|text| text.trim().to_string())
                .map_err(|error| format!("could not read audio.cpp transcript: {error}"))
        })();
        let _ = fs::remove_file(transcript_path);
        transcript
    }
}

#[derive(Debug)]
struct HelperOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn run_helper_with_timeout(
    command: &mut Command,
    label: &str,
    timeout: Duration,
) -> Result<HelperOutput, String> {
    let capture = TemporaryCommandCapture::new()
        .map_err(|error| format!("could not prepare {label} output capture: {error}"))?;
    capture
        .configure(command)
        .map_err(|error| format!("could not prepare {label} output capture: {error}"))?;
    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start {label}: {error}"))?;
    let started = Instant::now();

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{label} timed out after {} seconds",
                    timeout.as_secs()
                ));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("could not wait for {label}: {error}"));
            }
        }
    };
    let (stdout, stderr) = capture
        .read()
        .map_err(|error| format!("could not read {label} output: {error}"))?;
    Ok(HelperOutput {
        status,
        stdout,
        stderr,
    })
}

struct TemporaryCommandCapture {
    stdout_path: PathBuf,
    stderr_path: PathBuf,
}

impl TemporaryCommandCapture {
    fn new() -> std::io::Result<Self> {
        let directory = std::env::temp_dir().join("obsidian-local-stt");
        fs::create_dir_all(&directory)?;
        let id = Uuid::new_v4();
        Ok(Self {
            stdout_path: directory.join(format!("funasr-{id}.stdout")),
            stderr_path: directory.join(format!("funasr-{id}.stderr")),
        })
    }

    fn configure(&self, command: &mut Command) -> std::io::Result<()> {
        command.stdout(Stdio::from(File::create(&self.stdout_path)?));
        command.stderr(Stdio::from(File::create(&self.stderr_path)?));
        Ok(())
    }

    fn read(&self) -> std::io::Result<(Vec<u8>, Vec<u8>)> {
        Ok((fs::read(&self.stdout_path)?, fs::read(&self.stderr_path)?))
    }
}

impl Drop for TemporaryCommandCapture {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.stdout_path);
        let _ = fs::remove_file(&self.stderr_path);
    }
}

fn sensevoice_backend(accelerator: Option<AcceleratorId>) -> &'static str {
    match accelerator {
        Some(AcceleratorId::Vulkan) => "vulkan",
        _ => "cpu",
    }
}

fn nano_backend(accelerator: Option<AcceleratorId>) -> &'static str {
    match accelerator {
        Some(AcceleratorId::Vulkan) => "vulkan",
        _ => "cpu",
    }
}

fn nano_2512_language(language: &str) -> &str {
    // The checkpoint recognizes Cantonese as part of its Chinese dialect
    // coverage, while audio.cpp exposes the decoder selector as `zh`.
    if language == "yue" { "zh" } else { language }
}

fn parse_helper_output(stdout: &[u8]) -> String {
    stdout
        .split(|byte| *byte == b'\n')
        .filter_map(|line| std::str::from_utf8(line).ok())
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

impl StreamingModel for LoadedFunasrHybridModel {
    fn partial_cadence(&self) -> StreamingPartialCadence {
        StreamingPartialCadence {
            min_audio_samples: 1_600,
            min_wall_time: Duration::from_millis(100),
        }
    }

    fn accept_audio(&mut self, samples: &[i16]) -> Result<(), TranscriptionError> {
        self.samples.extend_from_slice(samples);
        let normalized = samples
            .iter()
            .map(|sample| f32::from(*sample) / 32_768.0)
            .collect::<Vec<_>>();
        self.online_stream.accept_waveform(SAMPLE_RATE, &normalized);
        Ok(())
    }

    fn set_language(&mut self, language: &str) -> Result<(), TranscriptionError> {
        if !self.samples.is_empty() {
            return Err(TranscriptionError::transcription_failure(
                "FunASR language selection",
                "cannot change language during an open utterance",
            ));
        }
        let supported = match &self.paths.final_model {
            FinalModelPaths::Nano { .. } => matches!(language, "zh" | "en" | "auto"),
            FinalModelPaths::Nano2512 { .. } => {
                matches!(language, "zh" | "yue" | "en" | "ja" | "auto")
            }
            FinalModelPaths::SenseVoice { .. } => {
                matches!(language, "zh" | "yue" | "en" | "ja" | "ko" | "auto")
            }
        };
        match supported {
            true => {
                self.language = language.to_string();
                Ok(())
            }
            false => Err(TranscriptionError::unsupported_language(
                language,
                "The selected FunASR final model does not support this language.",
            )),
        }
    }

    fn partial(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
        while self.recognizer.is_ready(&self.online_stream) {
            self.recognizer.decode(&self.online_stream);
        }
        let text = self
            .recognizer
            .get_result(&self.online_stream)
            .map(|result| result.text)
            .unwrap_or_default();
        Ok(engine_output(&text, self.samples.len()))
    }

    fn finalize_utterance(&mut self) -> Result<EngineTranscriptOutput, TranscriptionError> {
        let sample_count = self.samples.len();
        let result = self
            .run_final_pass()
            .map(|text| engine_output(&text, sample_count));
        self.reset_utterance();
        result
    }

    fn reset_utterance(&mut self) {
        self.online_stream = self.recognizer.create_stream();
        self.samples.clear();
    }
}

fn engine_output(text: &str, sample_count: usize) -> EngineTranscriptOutput {
    let normalized = suppress_repeated_tail(text.trim());
    let text = normalized.as_str();
    if text.is_empty() {
        return EngineTranscriptOutput {
            detected_language: None,
            diagnostics: Vec::new(),
            segments: Vec::new(),
        };
    }

    EngineTranscriptOutput {
        detected_language: None,
        diagnostics: vec![SegmentDiagnostics {
            avg_logprob: None,
            decode_reached_eos: Some(true),
            no_speech_prob: None,
            token_count: Some(text.chars().count() as u32),
        }],
        segments: vec![TranscriptSegment {
            end_ms: (sample_count as u64 * 1_000) / SAMPLE_RATE as u64,
            speaker: None,
            start_ms: 0,
            text: text.to_string(),
            timestamp_granularity: TimestampGranularity::Utterance,
            timestamp_source: TimestampSource::Vad,
            words: Vec::new(),
        }],
    }
}

/// Fun-ASR can hallucinate a short token over and over when an utterance ends
/// in silence. Keep ordinary repetitions intact, but cap an unmistakable
/// repeated tail (six or more copies of the same 1-8 character phrase).
fn suppress_repeated_tail(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() < 12 {
        return text.to_string();
    }

    for start in 0..chars.len() {
        let remaining = chars.len() - start;
        for unit_len in 1..=8 {
            if remaining < unit_len * 6 || !remaining.is_multiple_of(unit_len) {
                continue;
            }
            let unit = &chars[start..start + unit_len];
            if (1..remaining / unit_len).any(|copy| {
                let offset = start + copy * unit_len;
                &chars[offset..offset + unit_len] != unit
            }) {
                continue;
            }

            let mut result: String = chars[..start].iter().collect();
            result.extend(unit.iter());
            result.extend(unit.iter());
            return result;
        }
    }
    text.to_string()
}

struct TemporaryWav {
    path: PathBuf,
}

impl TemporaryWav {
    fn write(samples: &[i16]) -> Result<Self, TranscriptionError> {
        let data_len = samples
            .len()
            .checked_mul(std::mem::size_of::<i16>())
            .and_then(|len| u32::try_from(len).ok())
            .ok_or_else(|| {
                TranscriptionError::transcription_failure(
                    "FunASR temporary audio",
                    "utterance is too large to write as WAV",
                )
            })?;
        let directory = std::env::temp_dir().join("obsidian-local-stt");
        fs::create_dir_all(&directory).map_err(|error| {
            TranscriptionError::transcription_failure("FunASR temporary audio", error)
        })?;
        let path = directory.join(format!(
            "funasr-{}-{}.wav",
            std::process::id(),
            Uuid::new_v4()
        ));
        let mut file = File::create(&path).map_err(|error| {
            TranscriptionError::transcription_failure("FunASR temporary audio", error)
        })?;

        file.write_all(b"RIFF")
            .and_then(|()| file.write_all(&(36_u32.saturating_add(data_len)).to_le_bytes()))
            .and_then(|()| file.write_all(b"WAVEfmt "))
            .and_then(|()| file.write_all(&16_u32.to_le_bytes()))
            .and_then(|()| file.write_all(&1_u16.to_le_bytes()))
            .and_then(|()| file.write_all(&1_u16.to_le_bytes()))
            .and_then(|()| file.write_all(&(SAMPLE_RATE as u32).to_le_bytes()))
            .and_then(|()| file.write_all(&((SAMPLE_RATE as u32 * 2).to_le_bytes())))
            .and_then(|()| file.write_all(&2_u16.to_le_bytes()))
            .and_then(|()| file.write_all(&16_u16.to_le_bytes()))
            .and_then(|()| file.write_all(b"data"))
            .and_then(|()| file.write_all(&data_len.to_le_bytes()))
            .map_err(|error| {
                TranscriptionError::transcription_failure("FunASR temporary audio", error)
            })?;

        let mut pcm = Vec::with_capacity(data_len as usize);
        for sample in samples {
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
        file.write_all(&pcm).map_err(|error| {
            TranscriptionError::transcription_failure("FunASR temporary audio", error)
        })?;

        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryWav {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        FINAL_VAD_FILENAME, FinalModelPaths, FunasrHybridAdapter, ONLINE_DECODER_FILENAME,
        ONLINE_ENCODER_FILENAME, ONLINE_TOKENS_FILENAME, audio_cpp_helper_supports_backend,
        engine_output, nano_helper_supports_backend, parse_helper_output, run_helper_with_timeout,
        sensevoice_backend, suppress_repeated_tail, verify_gguf,
    };
    use crate::engine::capabilities::{AcceleratorId, LanguageSupport};
    use crate::engine::traits::ModelFamilyAdapter;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{Duration, Instant};

    #[test]
    fn engine_output_omits_an_empty_final_result() {
        let output = engine_output("  ", 16_000);
        assert!(output.segments.is_empty());
        assert!(output.diagnostics.is_empty());
    }

    #[test]
    fn engine_output_carries_punctuation_into_the_final_segment() {
        let output = engine_output("我觉得这毫无道理，显然不公平。", 16_000);
        assert_eq!(output.segments[0].text, "我觉得这毫无道理，显然不公平。");
        assert_eq!(output.segments[0].end_ms, 1_000);
    }

    #[test]
    fn repeated_tail_hallucinations_are_capped_without_removing_normal_repetition() {
        assert_eq!(
            suppress_repeated_tail("请确认不是不是不是不是不是不是不是不是"),
            "请确认不是不是"
        );
        assert_eq!(suppress_repeated_tail("不是不是"), "不是不是");
    }

    #[test]
    fn gguf_validation_rejects_an_unrelated_file() {
        let path = std::env::temp_dir().join(format!("funasr-test-{}.bin", uuid::Uuid::new_v4()));
        fs::write(&path, b"not-a-model").unwrap();
        let error = verify_gguf(&path).expect_err("non-GGUF files must be rejected");
        assert_eq!(error.code, "invalid_model_file");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn exact_final_model_language_support_does_not_overclaim_nano() {
        let nano = FinalModelPaths::Nano {
            encoder: PathBuf::from("encoder.gguf"),
            model: PathBuf::from("model.gguf"),
        };
        let sensevoice = FinalModelPaths::SenseVoice {
            model: PathBuf::from("model.gguf"),
        };
        let nano_2512 = FinalModelPaths::Nano2512 {
            model: PathBuf::from("model.gguf"),
        };

        assert_eq!(
            nano.language_support(),
            LanguageSupport::List {
                tags: vec!["zh".to_string(), "en".to_string()]
            }
        );
        assert_eq!(
            sensevoice.language_support(),
            LanguageSupport::List {
                tags: ["zh", "yue", "en", "ja", "ko"]
                    .into_iter()
                    .map(str::to_string)
                    .collect()
            }
        );
        assert_eq!(
            nano_2512.language_support(),
            LanguageSupport::List {
                tags: ["zh", "yue", "en", "ja"]
                    .into_iter()
                    .map(str::to_string)
                    .collect()
            }
        );
    }

    #[test]
    fn family_advertises_the_language_selection_implemented_by_streaming_models() {
        assert!(
            FunasrHybridAdapter
                .capabilities()
                .supports_language_selection
        );
    }

    #[test]
    fn concrete_final_model_controls_hardware_acceleration_support() {
        let sensevoice_root = test_model_directory("sensevoice");
        write_hybrid_scaffold(&sensevoice_root);
        fs::write(sensevoice_root.join("sensevoice-small-q8.gguf"), b"GGUF").unwrap();

        let nano_root = test_model_directory("nano");
        write_hybrid_scaffold(&nano_root);
        fs::write(nano_root.join("funasr-encoder-f16.gguf"), b"GGUF").unwrap();
        fs::write(nano_root.join("qwen3-0.6b-q5km.gguf"), b"GGUF").unwrap();

        let nano_2512_root = test_model_directory("nano-2512");
        write_hybrid_scaffold(&nano_2512_root);
        fs::write(nano_2512_root.join("fun-asr-nano-2512-q8_0.gguf"), b"GGUF").unwrap();

        assert!(FunasrHybridAdapter.supports_accelerator_for_model(
            &sensevoice_root.join(ONLINE_ENCODER_FILENAME),
            AcceleratorId::Vulkan,
        ));
        assert!(!FunasrHybridAdapter.supports_accelerator_for_model(
            &sensevoice_root.join(ONLINE_ENCODER_FILENAME),
            AcceleratorId::Cuda,
        ));
        assert_eq!(
            FunasrHybridAdapter.supports_accelerator_for_model(
                &nano_root.join(ONLINE_ENCODER_FILENAME),
                AcceleratorId::Vulkan,
            ),
            nano_helper_supports_backend(AcceleratorId::Vulkan),
        );
        assert_eq!(
            FunasrHybridAdapter.supports_accelerator_for_model(
                &nano_2512_root.join(ONLINE_ENCODER_FILENAME),
                AcceleratorId::Vulkan,
            ),
            audio_cpp_helper_supports_backend(AcceleratorId::Vulkan),
        );
        fs::remove_dir_all(sensevoice_root).unwrap();
        fs::remove_dir_all(nano_root).unwrap();
        fs::remove_dir_all(nano_2512_root).unwrap();
    }

    #[test]
    fn only_vulkan_selects_the_sensevoice_vulkan_backend() {
        assert_eq!(sensevoice_backend(Some(AcceleratorId::Vulkan)), "vulkan");
        assert_eq!(sensevoice_backend(Some(AcceleratorId::Cuda)), "cpu");
        assert_eq!(sensevoice_backend(None), "cpu");
    }

    #[test]
    fn helper_output_keeps_only_nonempty_transcript_lines() {
        assert_eq!(
            parse_helper_output("\n第一句。\n\n第二句。\n".as_bytes()),
            "第一句。 第二句。"
        );
    }

    #[test]
    fn helper_runner_captures_stdout_and_stderr() {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("printf 'transcript'; printf 'diagnostic' >&2");

        let output = run_helper_with_timeout(&mut command, "test helper", Duration::from_secs(1))
            .expect("helper should finish");

        assert!(output.status.success());
        assert_eq!(output.stdout, b"transcript");
        assert_eq!(output.stderr, b"diagnostic");
    }

    #[test]
    fn helper_runner_kills_a_process_after_its_deadline() {
        let mut command = Command::new("sh");
        command.arg("-c").arg("exec sleep 1");
        let started = Instant::now();

        let error = run_helper_with_timeout(&mut command, "test helper", Duration::from_millis(20))
            .expect_err("helper should time out");

        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    fn test_model_directory(label: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("funasr-{label}-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_hybrid_scaffold(root: &Path) {
        for filename in [
            ONLINE_ENCODER_FILENAME,
            ONLINE_DECODER_FILENAME,
            ONLINE_TOKENS_FILENAME,
            FINAL_VAD_FILENAME,
        ] {
            fs::write(root.join(filename), b"fixture").unwrap();
        }
    }
}
