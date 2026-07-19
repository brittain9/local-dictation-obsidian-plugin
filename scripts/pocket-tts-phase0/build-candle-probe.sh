#!/usr/bin/env bash
set -euo pipefail

# Reproduces the D1 binary-size gate without adding a crate or build output to
# the repository. Pass a directory to preserve the scratch build for audit.
if [[ $# -gt 1 ]]; then
  echo "usage: $0 [scratch-directory]" >&2
  exit 2
fi

cleanup=false
if [[ $# -eq 1 ]]; then
  scratch=$1
  mkdir -p "$scratch"
else
  scratch=$(mktemp -d -t pocket-tts-candle-probe.XXXXXXXX)
  cleanup=true
fi

if $cleanup; then
  trap 'rm -rf -- "$scratch"' EXIT
fi

mkdir -p "$scratch/src" "$scratch/ccache"
cat >"$scratch/Cargo.toml" <<'TOML'
[package]
name = "pocket-tts-size-probe"
version = "0.0.0"
edition = "2021"

[features]
tts = ["dep:pocket-tts"]

[dependencies]
anyhow = "=1.0.104"
pocket-tts = { version = "=0.6.2", optional = true }

[profile.release]
lto = "thin"
codegen-units = 1
strip = "symbols"
TOML

cat >"$scratch/src/main.rs" <<'RS'
fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    #[cfg(feature = "tts")]
    if args.len() >= 5 {
        use pocket_tts::TTSModel;
        let cfg = std::fs::read(&args[1])?;
        let weights = std::fs::read(&args[2])?;
        let tokenizer = std::fs::read(&args[3])?;
        let model = TTSModel::load_from_bytes(&cfg, &weights, &tokenizer)?;
        let voice = model.get_voice_state_from_prompt_file(std::path::Path::new(&args[4]))?;
        let mut total = 0usize;
        for chunk in model.generate_stream_long("Hello from the probe.", &voice) {
            total += chunk?.elem_count();
        }
        println!("samples: {total}");
    }
    println!("probe ok: {} args", args.len());
    Ok(())
}
RS

export CARGO_TARGET_DIR="$scratch/target"
export CCACHE_DIR="$scratch/ccache"

cargo build --manifest-path "$scratch/Cargo.toml" --release
binary="$CARGO_TARGET_DIR/release/pocket-tts-size-probe"
baseline_bytes=$(stat -c %s "$binary")
gzip -9 -n -c "$binary" >"$scratch/baseline.gz"
baseline_gzip_bytes=$(stat -c %s "$scratch/baseline.gz")

cargo build --manifest-path "$scratch/Cargo.toml" --release --features tts
tts_bytes=$(stat -c %s "$binary")
gzip -9 -n -c "$binary" >"$scratch/tts.gz"
tts_gzip_bytes=$(stat -c %s "$scratch/tts.gz")

cat <<JSON
{
  "baseline_bytes": $baseline_bytes,
  "baseline_gzip_9_bytes": $baseline_gzip_bytes,
  "pocket_tts_bytes": $tts_bytes,
  "pocket_tts_gzip_9_bytes": $tts_gzip_bytes,
  "delta_bytes": $((tts_bytes - baseline_bytes)),
  "delta_gzip_9_bytes": $((tts_gzip_bytes - baseline_gzip_bytes))
}
JSON
