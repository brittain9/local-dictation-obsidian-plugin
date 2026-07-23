#!/usr/bin/env python3
"""Run the pinned ONNX reference loop and report Pocket TTS CPU RTF."""

from __future__ import annotations

import argparse
import json
import sys
import time
import wave
from pathlib import Path

import numpy as np


FIXTURES = {
    "english_2026-04": (
        "Pocket TTS turns a written note into natural speech while keeping every word "
        "on this computer. This fixture includes enough context to measure steady "
        "generation speed and streaming latency."
    ),
    "french_24l": (
        "Pocket TTS transforme une note écrite en parole naturelle, tout en gardant "
        "chaque mot sur cet ordinateur. Ce texte mesure la vitesse de génération."
    ),
    "german_24l": (
        "Pocket TTS verwandelt eine geschriebene Notiz in natürliche Sprache, während "
        "jedes Wort auf diesem Computer bleibt. Dieser Text misst die Geschwindigkeit."
    ),
    "spanish_24l": (
        "Pocket TTS convierte una nota escrita en voz natural y mantiene cada palabra "
        "en este ordenador. Este texto mide la velocidad de generación."
    ),
    "portuguese_24l": (
        "O Pocket TTS transforma uma nota escrita em fala natural e mantém cada palavra "
        "neste computador. Este texto mede a velocidade de geração."
    ),
    "italian_24l": (
        "Pocket TTS trasforma una nota scritta in un parlato naturale e mantiene ogni "
        "parola su questo computer. Questo testo misura la velocità di generazione."
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle_dir", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--precision", choices=("int8", "fp32"), default="int8")
    parser.add_argument("--voice", default="alba")
    parser.add_argument("--threads", type=int, default=2, help="0 uses ONNX Runtime defaults")
    parser.add_argument("--seed", type=int, default=288)
    parser.add_argument("--temperature", type=float, default=0.3)
    parser.add_argument("--text")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    bundle_dir = args.bundle_dir.resolve()
    variant = bundle_dir.name
    if variant not in FIXTURES and args.text is None:
        raise SystemExit(f"No fixture for {variant!r}; pass --text")

    runner = bundle_dir / "pocket_tts_onnx.py"
    if not runner.is_file():
        raise SystemExit(
            f"Missing {runner}; rerun download.py with --include-reference-runner"
        )
    sys.path.insert(0, str(bundle_dir))

    import onnxruntime as ort
    from pocket_tts_onnx import PocketTTSOnnx

    def make_session_options(_self: object) -> object:
        options = ort.SessionOptions()
        options.intra_op_num_threads = args.threads
        options.inter_op_num_threads = 1
        return options

    PocketTTSOnnx._make_session_options = make_session_options
    text = args.text or FIXTURES[variant]
    voice = bundle_dir / "embeddings" / f"{args.voice}.safetensors"

    load_started = time.perf_counter()
    model = PocketTTSOnnx(
        models_dir=str(bundle_dir),
        language=variant,
        precision=args.precision,
        device="cpu",
        temperature=args.temperature,
        lsd_steps=1,
    )
    load_seconds = time.perf_counter() - load_started

    np.random.seed(args.seed)
    generation_started = time.perf_counter()
    audio = model.generate(text, voice=voice)
    generation_seconds = time.perf_counter() - generation_started
    audio_seconds = len(audio) / model.sample_rate

    args.output.parent.mkdir(parents=True, exist_ok=True)
    model.save_audio(audio, args.output)
    with wave.open(str(args.output), "rb") as wav_file:
        wav = {
            "channels": wav_file.getnchannels(),
            "frames": wav_file.getnframes(),
            "sample_rate": wav_file.getframerate(),
            "sample_width_bytes": wav_file.getsampwidth(),
        }
    if wav["channels"] != 1 or wav["sample_rate"] != 24_000:
        raise RuntimeError(f"Unexpected output contract: {wav}")

    print(
        json.dumps(
            {
                "audio_seconds": audio_seconds,
                "decoder_dtype": str(audio.dtype),
                "generation_seconds": generation_seconds,
                "load_seconds": load_seconds,
                "onnxruntime_version": ort.__version__,
                "output": str(args.output),
                "precision": args.precision,
                "realtime_multiple": audio_seconds / generation_seconds,
                "rtf": generation_seconds / audio_seconds,
                "seed": args.seed,
                "temperature": args.temperature,
                "text": text,
                "threads": args.threads or "runtime-default",
                "variant": variant,
                "wav": wav,
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
