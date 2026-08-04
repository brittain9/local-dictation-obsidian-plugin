#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <bundle-directory> [scratch-directory]" >&2
  exit 2
fi

bundle=$(realpath "$1")
cleanup=false
if [[ $# -eq 2 ]]; then
  scratch=$2
  mkdir -p "$scratch"
else
  scratch=$(mktemp -d -t pocket-tts-onnx-probe.XXXXXXXX)
  cleanup=true
fi

if $cleanup; then
  trap 'rm -rf -- "$scratch"' EXIT
fi

graphs=(
  text_conditioner.onnx
  flow_lm_main_int8.onnx
  flow_lm_flow_int8.onnx
  mimi_encoder.onnx
  mimi_decoder_int8.onnx
)
for graph in "${graphs[@]}"; do
  if [[ ! -f "$bundle/$graph" ]]; then
    echo "missing graph: $bundle/$graph" >&2
    exit 1
  fi
done

mkdir -p "$scratch/src" "$scratch/ccache"
cat >"$scratch/Cargo.toml" <<'TOML'
[package]
name = "pocket-tts-ort-load-probe"
version = "0.0.0"
edition = "2024"

[dependencies]
anyhow = "=1.0.104"
ort = { version = "=2.0.0-rc.12", default-features = false, features = ["std", "download-binaries", "copy-dylibs", "ndarray", "preload-dylibs", "tls-rustls"] }

[profile.release]
lto = "thin"
codegen-units = 1
strip = "symbols"
TOML

cat >"$scratch/src/main.rs" <<'RS'
use anyhow::Context;
use ort::session::Session;

fn main() -> anyhow::Result<()> {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    anyhow::ensure!(!paths.is_empty(), "pass one or more ONNX graph paths");

    for path in paths {
        let builder = Session::builder().context("create ORT session builder")?;
        let builder = builder
            .with_intra_threads(2)
            .map_err(|error| anyhow::anyhow!("set ORT intra-op threads: {error}"))?;
        let mut builder = builder
            .with_inter_threads(1)
            .map_err(|error| anyhow::anyhow!("set ORT inter-op threads: {error}"))?;
        let session = builder
            .commit_from_file(&path)
            .with_context(|| format!("load {path}"))?;

        println!("loaded={path}");
        println!(
            "inputs={}",
            session
                .inputs()
                .iter()
                .map(|value| value.name())
                .collect::<Vec<_>>()
                .join(",")
        );
        println!(
            "outputs={}",
            session
                .outputs()
                .iter()
                .map(|value| value.name())
                .collect::<Vec<_>>()
                .join(",")
        );
    }
    Ok(())
}
RS

export CARGO_TARGET_DIR="$scratch/target"
export CCACHE_DIR="$scratch/ccache"

cargo build --manifest-path "$scratch/Cargo.toml" --release
"$CARGO_TARGET_DIR/release/pocket-tts-ort-load-probe" \
  "${graphs[@]/#/$bundle/}"
