#!/usr/bin/env bash
# Build sidecar: all speech families + CUDA GPU. Linux only.
# Output goes to target-cuda/ to avoid overwriting the CPU binary.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/build-cuda.sh [OPTIONS]

Build the CUDA-enabled native sidecar (Whisper, Cohere, Moonshine, and Nemotron).
Output: native/target-cuda/{debug|release}/local-dictation-sidecar

Options:
  --release   Build release binary instead of debug.
  --clean     Run cargo clean on the CUDA target directory before building.
  --jobs N    Parallel build job count (default: nproc or 4).
  --help      Show this help text.

Environment overrides:
  CC             Host C compiler       (default: newest supported /usr/bin/gcc-*)
  CXX            Host C++ compiler     (default: newest supported /usr/bin/g++-*)
  CUDAHOSTCXX    nvcc host compiler    (default: $CXX)
  CUDACXX        CUDA compiler         (default: /usr/local/cuda/bin/nvcc)
  CUDA_LIB_PATH  Library dir for RPATH (auto-detected from CUDACXX)
  CARGO_TIMINGS  Set to 1 to emit cargo timing HTML.
  CARGO_VERBOSE  Set to 1 for verbose cargo/rustc/CMake output.
  MIN_FREE_GB    Min free disk in GiB  (default: 10)
EOF
}

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  local cmd=$1
  if [[ "$cmd" == */* ]]; then
    [[ -x "$cmd" ]] || die "required executable not found: $cmd"
  else
    command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
  fi
}

require_glob_match() {
  local pattern=$1
  compgen -G "$pattern" >/dev/null || die "required runtime artifact missing after build: $pattern"
}

compiler_major() {
  local compiler=$1
  "$compiler" -dumpfullversion -dumpversion | awk -F. '{ print $1 }'
}

pick_supported_compiler() {
  local fallback=$1
  shift

  local candidate
  for candidate in "$@"; do
    [[ -x "$candidate" ]] || continue
    local major
    major=$(compiler_major "$candidate")
    [[ "$major" =~ ^[0-9]+$ ]] || continue
    if (( major <= 15 )); then
      printf '%s\n' "$candidate"
      return
    fi
  done

  printf '%s\n' "$fallback"
}

require_cuda_supported_compiler() {
  local label=$1
  local compiler=$2
  local major
  major=$(compiler_major "$compiler")
  [[ "$major" =~ ^[0-9]+$ ]] || die "failed to detect $label version from $compiler"

  if (( major > 15 )); then
    die "CUDA 13.2 does not support $label $compiler (GCC $major). Install gcc-15/g++-15 or set CC/CXX/CUDAHOSTCXX to a GCC <= 15 toolchain."
  fi
}

stage_runtime_artifact() {
  local artifact_path=$1
  local resolved_path
  resolved_path=$(readlink -f "$artifact_path")
  [[ -f "$resolved_path" ]] || die "runtime artifact does not resolve to a file: $artifact_path"

  if [[ "$resolved_path" != "$artifact_path" ]]; then
    rm -f "$artifact_path"
    cp "$resolved_path" "$artifact_path"
  fi
}

copy_resolved_artifact() {
  local source_path=$1
  local destination_path=$2
  local resolved_path
  resolved_path=$(readlink -f "$source_path")
  [[ -f "$resolved_path" ]] || die "runtime artifact does not resolve to a file: $source_path"
  cp "$resolved_path" "$destination_path"
}

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MANIFEST="$REPO_ROOT/native/Cargo.toml"

[[ -f "$MANIFEST" ]] || die "sidecar manifest not found at $MANIFEST"
[[ "$(uname -s)" == "Linux" ]] || die "CUDA build is Linux-only"

profile=debug
do_clean=0
jobs=$(nproc 2>/dev/null || echo 4)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) profile=release; shift ;;
    --clean)   do_clean=1; shift ;;
    --jobs)    [[ $# -ge 2 ]] || die "--jobs requires a value"; jobs=$2; shift 2 ;;
    --help)    usage; exit 0 ;;
    *)         die "unknown argument: $1" ;;
  esac
done

[[ "$jobs" =~ ^[0-9]+$ && "$jobs" -gt 0 ]] || die "jobs must be a positive integer"

# ---------------------------------------------------------------------------
# Toolchain
# ---------------------------------------------------------------------------

export PATH="/usr/local/cuda/bin:$HOME/.cargo/bin:$PATH"
default_cc=$(pick_supported_compiler /usr/bin/gcc /usr/bin/gcc-15 /usr/bin/gcc-14 /usr/bin/gcc-13 /usr/bin/gcc-12 /usr/bin/gcc)
default_cxx=$(pick_supported_compiler /usr/bin/g++ /usr/bin/g++-15 /usr/bin/g++-14 /usr/bin/g++-13 /usr/bin/g++-12 /usr/bin/g++)
export CC=${CC:-$default_cc}
export CXX=${CXX:-$default_cxx}
export CUDAHOSTCXX=${CUDAHOSTCXX:-$CXX}
export CUDACXX=${CUDACXX:-/usr/local/cuda/bin/nvcc}
export WHISPER_DONT_GENERATE_BINDINGS=1
export WHISPER_CCACHE=OFF
export GGML_CCACHE=OFF
export CMAKE_ARGS="${CMAKE_ARGS:+$CMAKE_ARGS }-DWHISPER_CCACHE=OFF -DGGML_CCACHE=OFF"
# Pin the ONNX Runtime CUDA execution-provider major so local and CI builds
# resolve the same pyke binaries instead of auto-detecting from whatever CUDA
# toolkit happens to be on PATH. The release config is authoritative; callers
# may still override it explicitly for local compatibility testing.
if [[ -z "${ORT_CUDA_VERSION:-}" ]]; then
  require_cmd node
  ORT_CUDA_VERSION=$(node scripts/read-release-build-config.mjs --field ortCudaVersion)
fi
export ORT_CUDA_VERSION

require_cmd cargo
require_cmd rustc
require_cmd "$CC"
require_cmd "$CXX"
require_cmd "$CUDAHOSTCXX"
require_cmd "$CUDACXX"
require_cuda_supported_compiler "CC" "$CC"
require_cuda_supported_compiler "CXX" "$CXX"
require_cuda_supported_compiler "CUDAHOSTCXX" "$CUDAHOSTCXX"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

host_triple=$(rustc -vV | sed -n 's/^host: //p')
[[ -n "$host_triple" ]] || die "failed to detect Rust host triple"

cuda_root=$(dirname "$(dirname "$CUDACXX")")
cuda_lib="${CUDA_LIB_PATH:-${cuda_root}/targets/$(uname -m)-linux/lib}"
[[ -d "$cuda_lib" ]] || die "CUDA lib directory not found: $cuda_lib (override with CUDA_LIB_PATH)"

target_dir="$REPO_ROOT/native/target-cuda"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

min_free_gb=${MIN_FREE_GB:-10}
available_kb=$(df -Pk "$REPO_ROOT" | awk 'NR==2 { print $4 }')
required_kb=$((min_free_gb * 1024 * 1024))
(( available_kb >= required_kb )) || die "need at least ${min_free_gb} GiB free on the build volume"

printf 'CUDA sidecar build\n'
printf '  profile:  %s\n' "$profile"
printf '  jobs:     %s\n' "$jobs"
printf '  host:     %s\n' "$host_triple"
printf '  cc:       %s\n' "$CC"
printf '  nvcc:     %s\n' "$CUDACXX"
printf '  cuda lib: %s\n' "$cuda_lib"
printf '  target:   %s\n' "$target_dir"
printf '  arch:     %s\n' "${CMAKE_CUDA_ARCHITECTURES:-<default>}"
printf '  timings:  %s\n' "${CARGO_TIMINGS:-0}"
printf '  verbose:  %s\n' "${CARGO_VERBOSE:-0}"
printf '\n'

# ---------------------------------------------------------------------------
# Clean (opt-in)
# ---------------------------------------------------------------------------

if (( do_clean )); then
  printf 'Cleaning CUDA target directory...\n'
  cargo clean --manifest-path "$MANIFEST" --target-dir "$target_dir"
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

args=(
  build
  --locked
  --manifest-path "$MANIFEST"
  --target-dir "$target_dir"
  --features gpu-cuda,gpu-ort-cuda
  -j "$jobs"
  --config "host.linker=\"${CC}\""
  --config "host.rustflags=[\"-C\",\"link-arg=-fuse-ld=bfd\"]"
  --config "target.${host_triple}.linker=\"${CC}\""
  --config "target.${host_triple}.rustflags=[\"-C\",\"link-arg=-fuse-ld=bfd\",\"-C\",\"link-arg=-Wl,-rpath,\$ORIGIN\"]"
)
[[ "$profile" == "release" ]] && args+=(--release)
[[ "${CARGO_TIMINGS:-}" == "1" ]] && args+=(--timings)
[[ "${CARGO_VERBOSE:-}" == "1" ]] && args+=(-vv)

printf 'Building CUDA sidecar (%s)...\n' "$profile"
printf 'cargo %q ' "${args[@]}"
printf '\n'
cargo "${args[@]}"

binary="$target_dir/$profile/local-dictation-sidecar"
[[ -f "$binary" ]] || die "build completed but binary not found at $binary"

while IFS= read -r provider; do
  require_glob_match "$target_dir/$profile/${provider}*"
  stage_runtime_artifact "$target_dir/$profile/$provider"
done < <(node "$REPO_ROOT/scripts/list-cuda-artifacts.mjs" providers linux)

while IFS= read -r runtime; do
  copy_resolved_artifact "$cuda_lib/$runtime" "$target_dir/$profile/$runtime"
done < <(node "$REPO_ROOT/scripts/list-cuda-artifacts.mjs" runtime linux)
printf 'Done: %s\n' "$binary"
