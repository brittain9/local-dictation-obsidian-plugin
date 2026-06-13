// Pick the first directory from `candidates` for which `exists(dir)` is true.
// Factored out of package-sidecar-archive.mjs so the bin\x64-vs-bin fallback
// (CUDA 13 may relocate Windows runtime DLLs; the move is unconfirmed) is unit
// testable without a real CUDA install.

export function pickFirstExistingDir(candidates, exists) {
  for (const dir of candidates) {
    if (exists(dir)) return dir;
  }
  throw new Error(`none of the candidate directories exist: ${candidates.join(', ')}`);
}
