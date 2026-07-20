#!/usr/bin/env python3
"""Synchronize the shipping Pocket TTS catalog from the immutable pin manifest."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = Path(__file__).with_name("artifacts.json")
CATALOG_PATH = ROOT / "native" / "catalog.json"

MODEL_VARIANTS = (
    ("pocket_tts_english_2026_04_int8", "english_2026-04", "English", "en"),
    ("pocket_tts_french_24l_int8", "french_24l", "Français", "fr"),
    ("pocket_tts_german_int8", "german", "Deutsch", "de"),
    ("pocket_tts_spanish_int8", "spanish", "Español", "es"),
    ("pocket_tts_portuguese_int8", "portuguese", "Português", "pt"),
    ("pocket_tts_italian_int8", "italian", "Italiano", "it"),
)

RUNTIME_FILES = {
    "bundle.json",
    "tokenizer.model",
    "text_conditioner.onnx",
    "flow_lm_main_int8.onnx",
    "flow_lm_flow_int8.onnx",
    "mimi_decoder_int8.onnx",
}


def artifact_id(install_path: str) -> str:
    if install_path.startswith("embeddings/"):
        return f"voice_{Path(install_path).stem}"
    return {
        "bundle.json": "bundle",
        "tokenizer.model": "tokenizer",
        "text_conditioner.onnx": "text_conditioner",
        "flow_lm_main_int8.onnx": "flow_lm_main",
        "flow_lm_flow_int8.onnx": "flow_lm_flow",
        "mimi_decoder_int8.onnx": "mimi_decoder",
    }[install_path]


def catalog_artifact(item: dict[str, object], variant: str) -> dict[str, object]:
    install_path = str(item["install_path"])
    voice = Path(install_path).stem if install_path.startswith("embeddings/") else None
    required = voice is None or voice == "alba" or variant == "french_24l"
    role = (
        "voice"
        if voice is not None
        else "synthesis_model"
        if install_path == "flow_lm_main_int8.onnx"
        else "supporting_file"
    )
    result: dict[str, object] = {
        "artifactId": artifact_id(install_path),
        "role": role,
        "required": required,
        "filename": install_path,
        "downloadUrl": item["url"],
        "sha256": item["sha256"],
        "sizeBytes": item["size"],
    }
    if voice is not None:
        result["voiceId"] = voice
    return result


def build_model(
    manifest: dict[str, object],
    model_id: str,
    variant: str,
    native_language: str,
    language_tag: str,
) -> dict[str, object]:
    variant_data = manifest["variants"][variant]
    artifacts = [
        catalog_artifact(item, variant)
        for item in variant_data["artifacts"]
        if item["install_path"] in RUNTIME_FILES
        or str(item["install_path"]).startswith("embeddings/")
    ]
    french = variant == "french_24l"
    display_language = "French" if french else native_language
    return {
        "runtimeId": "onnx_runtime",
        "familyId": "pocket_tts",
        "task": "tts",
        "modelId": model_id,
        "collectionId": "pocket_tts_read_aloud",
        "displayName": f"Pocket TTS {display_language}",
        "summary": (
            "Higher-quality local French read-aloud synthesis using the pinned 24-layer int8 ONNX export."
            if french
            else f"Fast local {display_language} read-aloud synthesis using the pinned int8 ONNX export."
        ),
        "languageTags": [language_tag],
        "defaultVoice": "alba",
        "uxTags": (
            ["read-aloud", "high-cpu", "may-buffer"]
            if french
            else ["read-aloud", "cpu", "streaming"]
        ),
        "licenseLabel": "CC-BY-4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "sourceUrl": (
            "https://huggingface.co/KevinAHM/pocket-tts-onnx/tree/"
            f"{manifest['sources']['onnx']['revision']}/onnx/{variant}"
        ),
        "modelCardUrl": (
            "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/"
            f"{manifest['sources']['voices']['revision']}/languages/{variant}"
        ),
        "notes": [
            (
                "The 24-layer French bundle includes all six curated voices and may buffer at higher playback speeds on slower CPUs."
                if french
                else "The initial install includes the runtime and Alba voice; Cosette, Fantine, Javert, Jean, and Marius are optional downloads."
            ),
            "Synthesis produces 24 kHz mono audio. Playback speed is adjusted locally with pitch-preserving time stretch.",
            "The model graphs and voice embeddings are licensed under CC-BY-4.0, not this project's MIT license.",
        ],
        "artifacts": artifacts,
    }


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    catalog["catalogVersion"] = max(int(catalog["catalogVersion"]), 5)

    family = next(item for item in catalog["families"] if item["familyId"] == "pocket_tts")
    family["summary"] = (
        "Local read-aloud synthesis in English, French, German, Spanish, Portuguese, and Italian "
        "with selectable curated voices and pitch-preserving speed control."
    )
    collection = next(
        item
        for item in catalog["collections"]
        if item["collectionId"] == "pocket_tts_read_aloud"
    )
    collection["summary"] = "Local multilingual read-aloud models and curated voice embeddings."

    catalog["models"] = [
        model for model in catalog["models"] if model["familyId"] != "pocket_tts"
    ] + [build_model(manifest, *variant) for variant in MODEL_VARIANTS]
    CATALOG_PATH.write_text(f"{json.dumps(catalog, indent=2, ensure_ascii=False)}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
