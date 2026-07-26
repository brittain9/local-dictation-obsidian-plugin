import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// The Windows release job installs only the CUDA sub-packages listed in
// .github/cuda-windows-subpackages.json (full-toolkit installs are slow), so
// every whisper.cpp runtime DLL we redistribute (native/cuda-artifacts.json)
// must have its providing sub-package in that list — otherwise the installer
// never drops the DLL and the packager's copyFile fails the release.
const SUBPACKAGES_PATH = '.github/cuda-windows-subpackages.json';
const ARTIFACTS_PATH = 'native/cuda-artifacts.json';

// Maps a Windows CUDA runtime DLL's library stem (the name minus the
// `64_<soname>.dll` suffix) to the installer sub-package that ships it. Most
// libraries are self-named; cublasLt is the exception — it rides along in the
// cublas runtime package rather than one of its own.
const LIBRARY_TO_SUBPACKAGE: Record<string, string> = {
  cudart: 'cudart',
  cublas: 'cublas',
  cublasLt: 'cublas',
};

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('Windows CUDA sub-packages', () => {
  it('installs a sub-package for every redistributed runtime DLL', async () => {
    const subPackages = (await readJson(SUBPACKAGES_PATH)) as string[];
    const { win32 } = (await readJson(ARTIFACTS_PATH)) as { win32: string[] };

    for (const dll of win32) {
      const stem = dll.match(/^(.+?)64_\d+\.dll$/)?.[1];
      if (stem === undefined) {
        throw new Error(`unrecognized Windows CUDA DLL name: ${dll}`);
      }
      const subPackage = LIBRARY_TO_SUBPACKAGE[stem];
      if (subPackage === undefined) {
        throw new Error(`no known sub-package mapping for ${dll}`);
      }
      expect(subPackages, `${dll} needs the '${subPackage}' sub-package installed`).toContain(
        subPackage,
      );
    }
  });

  it('ships only the CUDA libraries used by whisper.cpp', async () => {
    const artifacts = (await readJson(ARTIFACTS_PATH)) as Record<string, string[]>;
    const redistributed = Object.values(artifacts).flat();

    expect(redistributed.every((name) => !/onnxruntime|cudnn|cufft|curand/i.test(name))).toBe(true);
  });
});
