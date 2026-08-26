#!/usr/bin/env python3
"""Download and verify one pinned Pocket TTS Phase 0 artifact bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path


REFERENCE_RUNNER = {
    "install_path": "pocket_tts_onnx.py",
    "sha256": "4381a4396ba08b2626a25a87001e3c51dbacd136e1022d2d40a8cefb14b44be0",
    "size": 28816,
    "url": (
        "https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/"
        "58a6d00cf13d239b6748cb0769f35c580a8f606c/pocket_tts_onnx.py"
    ),
}


def sha256(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def verified(path: Path, artifact: dict[str, object]) -> bool:
    if not path.is_file() or path.stat().st_size != artifact["size"]:
        return False
    digest, _ = sha256(path)
    return digest == artifact["sha256"]


def safe_destination(root: Path, relative: str) -> Path:
    destination = (root / relative).resolve()
    try:
        destination.relative_to(root.resolve())
    except ValueError as error:
        raise ValueError(f"Artifact path escapes output directory: {relative}") from error
    return destination


def download(root: Path, artifact: dict[str, object]) -> None:
    destination = safe_destination(root, str(artifact["install_path"]))
    if verified(destination, artifact):
        print(f"verified {destination}")
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.part-{os.getpid()}")
    try:
        digest = hashlib.sha256()
        size = 0
        print(f"downloading {artifact['url']} -> {destination}")
        with urllib.request.urlopen(str(artifact["url"])) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
            output.flush()
            os.fsync(output.fileno())

        if size != artifact["size"] or digest.hexdigest() != artifact["sha256"]:
            raise RuntimeError(
                f"Verification failed for {destination}: "
                f"size={size}, sha256={digest.hexdigest()}"
            )
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("variant", help="Variant key from artifacts.json")
    parser.add_argument("output_dir", type=Path, help="Directory outside Git for downloaded files")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path(__file__).with_name("artifacts.json"),
    )
    parser.add_argument(
        "--include-reference-runner",
        action="store_true",
        help="Also fetch the pinned third-party Python reference loop used by bench.py",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text())
    variants = manifest["variants"]
    if args.variant not in variants:
        choices = ", ".join(sorted(variants))
        raise SystemExit(f"Unknown variant {args.variant!r}; choose one of: {choices}")

    root = args.output_dir.resolve() / args.variant
    artifacts = list(variants[args.variant]["artifacts"])
    if args.include_reference_runner:
        artifacts.append(REFERENCE_RUNNER)
    for artifact in artifacts:
        download(root, artifact)
    print(f"ready: {root}", file=sys.stderr)


if __name__ == "__main__":
    main()
