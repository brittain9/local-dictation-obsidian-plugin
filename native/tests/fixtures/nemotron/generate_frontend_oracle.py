#!/usr/bin/env python3
"""Generate the full deterministic NeMo frontend oracle for Stage A.

Usage:
  python generate_frontend_oracle.py /path/to/pinned/NeMo/checkout

The checkout must be at NEMO_REVISION. The script loads FilterbankFeatures
directly from that checkout, so the committed binary is produced by the
reference implementation instead of a local transcription of its math.
"""

from __future__ import annotations

import hashlib
import importlib.util
import subprocess
import sys
import types
from pathlib import Path

import librosa
import numpy as np
import soundfile
import torch

NEMO_REVISION = "06312c963ce69c308d67ec7f129800ba594d9565"
FEATURE_DIM = 128
EXPECTED_FRAMES = 1112
EXPECTED_VERSIONS = {
    "librosa": "0.11.0",
    "numpy": "2.4.6",
    "soundfile": "0.13.1",
    "torch": "2.12.1",
}


class _Logging:
    def debug(self, *_args: object, **_kwargs: object) -> None:
        pass

    def info(self, *_args: object, **_kwargs: object) -> None:
        pass

    def warning(self, *_args: object, **_kwargs: object) -> None:
        pass


def _load_filterbank_features(checkout: Path) -> type[torch.nn.Module]:
    actual_revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=checkout, text=True
    ).strip()
    if actual_revision != NEMO_REVISION:
        raise SystemExit(
            f"NeMo checkout is {actual_revision}; expected {NEMO_REVISION}"
        )

    # features.py needs these names at import time, but FilterbankFeatures does
    # not use the audio augmentation/file-loading implementations. Stubbing the
    # two imports avoids installing the rest of NeMo's training dependency tree.
    perturb = types.ModuleType(
        "nemo.collections.asr.parts.preprocessing.perturb"
    )
    perturb.AudioAugmentor = type("AudioAugmentor", (), {})
    segment = types.ModuleType(
        "nemo.collections.asr.parts.preprocessing.segment"
    )
    segment.AudioSegment = type("AudioSegment", (), {})
    utils = types.ModuleType("nemo.utils")
    utils.logging = _Logging()
    sys.modules[perturb.__name__] = perturb
    sys.modules[segment.__name__] = segment
    sys.modules[utils.__name__] = utils

    source = checkout / "nemo/collections/asr/parts/preprocessing/features.py"
    spec = importlib.util.spec_from_file_location("pinned_nemo_features", source)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not load {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.FilterbankFeatures


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {Path(sys.argv[0]).name} /path/to/NeMo")
    actual_versions = {
        "librosa": librosa.__version__,
        "numpy": np.__version__,
        "soundfile": soundfile.__version__,
        "torch": torch.__version__.split("+")[0],
    }
    if actual_versions != EXPECTED_VERSIONS:
        raise SystemExit(
            f"oracle dependency mismatch: expected {EXPECTED_VERSIONS}, found {actual_versions}"
        )
    checkout = Path(sys.argv[1]).resolve()
    filterbank_features = _load_filterbank_features(checkout)

    fixtures = Path(__file__).resolve().parents[1]
    audio_path = fixtures / "audio/7021-79740-0000.wav"
    output_path = Path(__file__).with_name("frontend-560ms.f32le")
    audio, sample_rate = soundfile.read(audio_path, dtype="float32")
    if sample_rate != 16_000 or audio.ndim != 1:
        raise SystemExit(f"unexpected audio format: {sample_rate} Hz, {audio.shape}")

    frontend = filterbank_features(
        sample_rate=16_000,
        n_window_size=400,
        n_window_stride=160,
        window="hann",
        normalize=None,
        n_fft=512,
        preemph=0.97,
        nfilt=FEATURE_DIM,
        lowfreq=0,
        highfreq=8_000,
        log=True,
        log_zero_guard_type="add",
        log_zero_guard_value=2**-24,
        dither=0.0,
        pad_to=0,
        mag_power=2.0,
    ).eval()
    samples = torch.from_numpy(audio).unsqueeze(0)
    lengths = torch.tensor([audio.shape[0]], dtype=torch.long)
    with torch.no_grad():
        features, feature_lengths = frontend(samples, lengths)
    frame_count = int(feature_lengths[0])
    if features.shape[1] != FEATURE_DIM or frame_count != EXPECTED_FRAMES:
        raise SystemExit(
            f"unexpected feature shape {tuple(features.shape)}, length {frame_count}"
        )

    oracle = (
        features[0, :, :frame_count]
        .contiguous()
        .cpu()
        .numpy()
        .astype("<f4", copy=False)
        .tobytes(order="C")
    )
    output_path.write_bytes(oracle)
    print(f"wrote {output_path} ({len(oracle)} bytes)")
    print(f"sha256 {hashlib.sha256(oracle).hexdigest()}")


if __name__ == "__main__":
    main()
