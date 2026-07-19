#!/usr/bin/env python3
"""Generate the immutable Pocket TTS ONNX runtime artifact manifest.

The Hugging Face paths-info response exposes a SHA-256 for LFS objects. Small
Git objects (notably bundle.json) are downloaded from the pinned revision and
hashed locally so every runtime download has one verification contract.
"""

from __future__ import annotations

import hashlib
import json
import urllib.parse
import urllib.request
from dataclasses import dataclass


ONNX_REPO = "KevinAHM/pocket-tts-onnx"
ONNX_REVISION = "58a6d00cf13d239b6748cb0769f35c580a8f606c"
VOICE_REPO = "kyutai/pocket-tts-without-voice-cloning"
VOICE_REVISION = "e041936c75475d350b405bc870bcf7c22da4e9e6"

VARIANTS = (
    "english_2026-04",
    "french_24l",
    "german_24l",
    "spanish_24l",
    "portuguese_24l",
    "italian_24l",
)

# Three feminine and three masculine predefined states from Kyutai's named
# voice set. Alba is the default used by the Phase 0 reference fixtures.
VOICES = ("alba", "cosette", "fantine", "javert", "jean", "marius")

# The reference wrapper initializes the Mimi encoder for voice cloning. Stage A
# accepts only precomputed safetensors voice states, so the production runtime
# never loads or downloads that graph. Phase 0 separately proved that all five
# export families load under the repository's pinned ORT version.
ONNX_FILES = (
    "bundle.json",
    "bos_before_voice.npy",
    "tokenizer.model",
    "text_conditioner.onnx",
    "flow_lm_main_int8.onnx",
    "flow_lm_flow_int8.onnx",
    "mimi_decoder_int8.onnx",
)


@dataclass(frozen=True)
class RepoPin:
    repo: str
    revision: str


def request_json(url: str, payload: dict[str, object]) -> object:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def resolve_url(pin: RepoPin, path: str) -> str:
    repo = urllib.parse.quote(pin.repo, safe="/")
    revision = urllib.parse.quote(pin.revision, safe="")
    artifact = urllib.parse.quote(path, safe="/")
    return f"https://huggingface.co/{repo}/resolve/{revision}/{artifact}"


def paths_info(pin: RepoPin, paths: list[str]) -> dict[str, dict[str, object]]:
    repo = urllib.parse.quote(pin.repo, safe="/")
    revision = urllib.parse.quote(pin.revision, safe="")
    url = f"https://huggingface.co/api/models/{repo}/paths-info/{revision}"
    result = request_json(url, {"paths": paths})
    if not isinstance(result, list):
        raise RuntimeError(f"Unexpected paths-info response for {pin.repo}")
    by_path = {item["path"]: item for item in result}
    missing = sorted(set(paths) - set(by_path))
    if missing:
        raise RuntimeError(f"Missing paths in {pin.repo}@{pin.revision}: {missing}")
    return by_path


def sha256_for(pin: RepoPin, item: dict[str, object]) -> str:
    lfs = item.get("lfs")
    if isinstance(lfs, dict):
        oid = lfs.get("oid")
        if isinstance(oid, str) and len(oid) == 64:
            return oid

    digest = hashlib.sha256()
    with urllib.request.urlopen(resolve_url(pin, str(item["path"]))) as response:
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def artifact(pin: RepoPin, item: dict[str, object], install_path: str) -> dict[str, object]:
    return {
        "install_path": install_path,
        "repo_path": item["path"],
        "sha256": sha256_for(pin, item),
        "size": item["size"],
        "url": resolve_url(pin, str(item["path"])),
    }


def main() -> None:
    onnx_pin = RepoPin(ONNX_REPO, ONNX_REVISION)
    voice_pin = RepoPin(VOICE_REPO, VOICE_REVISION)

    onnx_paths = [f"onnx/{variant}/{name}" for variant in VARIANTS for name in ONNX_FILES]
    voice_paths = [
        f"languages/{variant}/embeddings/{voice}.safetensors"
        for variant in VARIANTS
        for voice in VOICES
    ]
    onnx_info = paths_info(onnx_pin, onnx_paths)
    voice_info = paths_info(voice_pin, voice_paths)

    variants: dict[str, object] = {}
    for variant in VARIANTS:
        artifacts = []
        for name in ONNX_FILES:
            path = f"onnx/{variant}/{name}"
            artifacts.append(artifact(onnx_pin, onnx_info[path], name))
        for voice in VOICES:
            path = f"languages/{variant}/embeddings/{voice}.safetensors"
            artifacts.append(
                artifact(voice_pin, voice_info[path], f"embeddings/{voice}.safetensors")
            )
        variants[variant] = {
            "artifacts": artifacts,
            "default_voice": "alba",
            "total_size": sum(int(item["size"]) for item in artifacts),
        }

    manifest = {
        "schema_version": 1,
        "precision": "int8",
        "sources": {
            "onnx": {"repo": ONNX_REPO, "revision": ONNX_REVISION},
            "voices": {"repo": VOICE_REPO, "revision": VOICE_REVISION},
        },
        "variants": variants,
        "voices": list(VOICES),
    }
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
