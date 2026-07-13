import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  formatExternalModelValidationError,
  getExternalFileEngineOption,
  validateExternalModelFilePath,
} from '../src/models/external-model-file';

let modelDirectory: string;
let frontendPath: string;
let whisperPath: string;

beforeAll(async () => {
  modelDirectory = await mkdtemp(join(tmpdir(), 'external-model-file-test-'));
  frontendPath = join(modelDirectory, 'frontend.ort');
  whisperPath = join(modelDirectory, 'ggml-small.en-q5_1.bin');
  await Promise.all([
    writeFile(frontendPath, 'frontend fixture', 'utf8'),
    writeFile(whisperPath, 'whisper fixture', 'utf8'),
  ]);
});

afterAll(async () => {
  await rm(modelDirectory, { force: true, recursive: true });
});

describe('validateExternalModelFilePath', () => {
  it('returns a trimmed absolute path for an existing Whisper model file', async () => {
    await expect(
      validateExternalModelFilePath(`  ${whisperPath}  `, {
        familyId: 'whisper',
        runtimeId: 'whisper_cpp',
      }),
    ).resolves.toBe(whisperPath);
  });

  it('requires frontend.ort as the selected Moonshine artifact', async () => {
    await expect(
      validateExternalModelFilePath(whisperPath, {
        familyId: 'moonshine',
        runtimeId: 'onnx_runtime',
      }),
    ).rejects.toThrow(/requires its primary frontend\.ort artifact/);
  });

  it('accepts frontend.ort for authoritative sidecar layout validation', async () => {
    await expect(
      validateExternalModelFilePath(frontendPath, {
        familyId: 'moonshine',
        runtimeId: 'onnx_runtime',
      }),
    ).resolves.toBe(frontendPath);
  });
});

describe('external model guidance', () => {
  it('documents the exact Moonshine entry artifact and companion set', () => {
    const option = getExternalFileEngineOption({
      familyId: 'moonshine',
      runtimeId: 'onnx_runtime',
    });
    const guidance = option?.requirements.join(' ') ?? '';

    expect(guidance).toContain('frontend.ort');
    expect(guidance).toContain('encoder.ort');
    expect(guidance).toContain('adapter.ort');
    expect(guidance).toContain('cross_kv.ort');
    expect(guidance).toContain('decoder_kv.ort');
    expect(guidance).toContain('streaming_config.json');
    expect(guidance).toContain('tokenizer.bin');
    expect(guidance).toContain('Non-streaming');
  });

  it('documents both formats declared by the Whisper runtime', () => {
    const option = getExternalFileEngineOption({
      familyId: 'whisper',
      runtimeId: 'whisper_cpp',
    });
    const guidance = option?.requirements.join(' ') ?? '';

    expect(guidance).toContain('GGML');
    expect(guidance).toContain('GGUF');
  });

  it('preserves an actionable probe error for display', () => {
    expect(formatExternalModelValidationError(new Error('required asset missing'))).toBe(
      'required asset missing',
    );
    expect(formatExternalModelValidationError('not an Error')).toBe(
      'The speech engine could not validate this model.',
    );
  });
});
