import { describe, expect, it } from 'vitest';

import { buildInstallProgressViewModel } from '../src/models/model-install-progress';

describe('buildInstallProgressViewModel', () => {
  it('renders progress with bytes label, percent, and secondary detail', () => {
    expect(
      buildInstallProgressViewModel({
        details: 'File 2 of 3',
        downloadedBytes: 512,
        isCancelling: false,
        message: 'Downloading vocab.json',
        state: 'downloading',
        totalBytes: 1024,
      }),
    ).toEqual({
      bytesLabel: '512 B / 1.0 KiB',
      isCancelling: false,
      primaryLine: 'Downloading vocab.json',
      progressPercent: 50,
      secondaryLine: 'File 2 of 3',
    });
  });

  it.each([
    ['Downloading onnx/encoder_model_q4.onnx_data', 'Downloading encoder_model_q4.onnx_data'],
    ['Verifying onnx/encoder_model_q4.onnx_data', 'Verifying encoder_model_q4.onnx_data'],
    ['Downloading ggml-small.en-q5_1.bin', 'Downloading ggml-small.en-q5_1.bin'],
    ['Model install queued.', 'Model install queued.'],
  ])('strips artifact directory prefixes (%s → %s)', (input, expected) => {
    expect(
      buildInstallProgressViewModel({
        details: null,
        downloadedBytes: 0,
        isCancelling: false,
        message: input,
        state: 'downloading',
        totalBytes: 1024,
      }).primaryLine,
    ).toBe(expected);
  });

  it('clamps downloaded bytes that exceed the total and falls back to a verify message', () => {
    const vm = buildInstallProgressViewModel({
      details: null,
      downloadedBytes: 2048,
      isCancelling: true,
      message: null,
      state: 'verifying',
      totalBytes: 1024,
    });

    expect(vm.bytesLabel).toBe('1.0 KiB / 1.0 KiB');
    expect(vm.primaryLine).toBe('Verifying download');
    expect(vm.progressPercent).toBe(100);
    expect(vm.isCancelling).toBe(true);
  });

  it('does not render raw native diagnostics for a failed install', () => {
    const vm = buildInstallProgressViewModel({
      details: 'permission denied at /private/model/path',
      downloadedBytes: null,
      isCancelling: false,
      message: 'The model store path is invalid.',
      state: 'failed',
      totalBytes: null,
    });

    expect(vm.primaryLine).toBe('Model install failed');
    expect(vm.secondaryLine).toBeNull();
  });
});
