import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildInstallProgressViewModel,
  createInstallProgressElement,
  updateInstallProgressElement,
} from '../src/models/model-install-progress';
import { TestElement } from './__mocks__/obsidian';

const originals = {
  createDiv: globalThis.createDiv,
  createSpan: globalThis.createSpan,
};

beforeEach(() => {
  globalThis.createDiv = () => new TestElement() as unknown as HTMLDivElement;
  globalThis.createSpan = () => new TestElement() as unknown as HTMLSpanElement;
});

afterEach(() => {
  globalThis.createDiv = originals.createDiv;
  globalThis.createSpan = originals.createSpan;
});

function find(root: HTMLDivElement, className: string): TestElement | null {
  return (root as unknown as TestElement).querySelector(`.${className}`);
}

describe('install progress', () => {
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
        hasFailed: false,
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

    it('reports the failure reason and suppresses raw native diagnostics', () => {
      const vm = buildInstallProgressViewModel({
        details: 'permission denied at /private/model/path',
        downloadedBytes: null,
        isCancelling: false,
        message: 'The model store path is invalid.',
        state: 'failed',
        totalBytes: null,
      });

      expect(vm.hasFailed).toBe(true);
      expect(vm.primaryLine).toBe('Model install failed');
      // The reason, not `details` — that field carries native paths meant for logs.
      expect(vm.secondaryLine).toBe('The model store path is invalid.');
    });

    it('leaves the second line empty when a failure reports no reason', () => {
      const vm = buildInstallProgressViewModel({
        details: 'permission denied at /private/model/path',
        downloadedBytes: null,
        isCancelling: false,
        message: '   ',
        state: 'failed',
        totalBytes: null,
      });

      expect(vm.secondaryLine).toBeNull();
    });
  });

  describe('progress element reconciliation', () => {
    it('reconciles queued, downloading, verifying, and probing snapshots in place', () => {
      const root = createInstallProgressElement({
        details: null,
        downloadedBytes: null,
        isCancelling: false,
        message: null,
        state: 'queued',
        totalBytes: null,
      });
      const header = find(root, 'local-stt-install-progress__header');
      const status = find(root, 'local-stt-install-progress__status');
      const track = find(root, 'local-stt-install-progress__track');
      const fill = find(root, 'local-stt-install-progress__fill');
      const parent = new TestElement();
      parent.append(root as unknown as TestElement);

      expect(header).not.toBeNull();
      expect(status).not.toBeNull();
      expect(track).not.toBeNull();
      expect(fill).not.toBeNull();
      expect(track?.getAttribute('role')).toBe('progressbar');
      expect(track?.getAttribute('aria-label')).toBe('Preparing install');
      expect(track?.getAttribute('aria-valuemin')).toBe('0');
      expect(track?.getAttribute('aria-valuemax')).toBe('100');
      expect(track?.getAttribute('aria-valuenow')).toBeNull();

      updateInstallProgressElement(root, {
        details: 'File 1 of 3',
        downloadedBytes: 512,
        isCancelling: false,
        message: 'Downloading onnx/encoder.onnx',
        state: 'downloading',
        totalBytes: 1024,
      });

      const bytes = find(root, 'local-stt-install-progress__bytes');
      const details = find(root, 'local-stt-install-progress__details');
      expect(find(root, 'local-stt-install-progress__header')).toBe(header);
      expect(find(root, 'local-stt-install-progress__status')).toBe(status);
      expect(find(root, 'local-stt-install-progress__track')).toBe(track);
      expect(find(root, 'local-stt-install-progress__fill')).toBe(fill);
      expect(parent.children).toEqual([root]);
      expect(bytes?.textContent).toBe('512 B / 1.0 KiB');
      expect(details?.textContent).toBe('File 1 of 3');
      expect(fill?.style.width).toBe('50%');
      expect(track?.getAttribute('aria-valuenow')).toBe('50');

      updateInstallProgressElement(root, {
        details: 'File 2 of 3',
        downloadedBytes: 768,
        isCancelling: false,
        message: 'Downloading onnx/encoder.onnx',
        state: 'downloading',
        totalBytes: 1024,
      });

      expect(find(root, 'local-stt-install-progress__bytes')).toBe(bytes);
      expect(find(root, 'local-stt-install-progress__details')).toBe(details);
      expect(bytes?.textContent).toBe('768 B / 1.0 KiB');
      expect(details?.textContent).toBe('File 2 of 3');
      expect(status?.textContent).toBe('Downloading encoder.onnx');
      expect(track?.getAttribute('aria-valuenow')).toBe('75');

      updateInstallProgressElement(root, {
        details: 'File 3 of 3',
        downloadedBytes: 1024,
        isCancelling: false,
        message: 'Verifying onnx/encoder.onnx',
        state: 'verifying',
        totalBytes: 1024,
      });

      expect(find(root, 'local-stt-install-progress__bytes')).toBe(bytes);
      expect(find(root, 'local-stt-install-progress__details')).toBe(details);
      expect(bytes?.textContent).toBe('1.0 KiB / 1.0 KiB');
      expect(details?.textContent).toBe('File 3 of 3');
      expect(status?.textContent).toBe('Verifying encoder.onnx');
      expect(track?.getAttribute('aria-valuenow')).toBe('100');

      updateInstallProgressElement(root, {
        details: null,
        downloadedBytes: null,
        isCancelling: false,
        message: null,
        state: 'probing',
        totalBytes: null,
      });

      expect(find(root, 'local-stt-install-progress__bytes')).toBeNull();
      expect(find(root, 'local-stt-install-progress__details')).toBeNull();
      expect(track?.getAttribute('aria-label')).toBe('Validating model');
      expect(track?.getAttribute('aria-valuenow')).toBeNull();
      expect(fill?.style.width).toBe('0%');
    });

    it('switches aria progress semantics when cancellation changes determinate state', () => {
      const root = createInstallProgressElement({
        details: null,
        downloadedBytes: 2,
        isCancelling: false,
        message: 'Downloading model.bin',
        state: 'downloading',
        totalBytes: 3,
      });
      const track = find(root, 'local-stt-install-progress__track');
      const fill = find(root, 'local-stt-install-progress__fill');

      expect(track?.getAttribute('aria-valuenow')).toBe('67');

      updateInstallProgressElement(root, {
        details: null,
        downloadedBytes: null,
        isCancelling: true,
        message: null,
        state: 'downloading',
        totalBytes: null,
      });

      expect(
        (root as unknown as TestElement).classList.contains(
          'local-stt-install-progress--cancelling',
        ),
      ).toBe(true);
      expect(track?.getAttribute('aria-valuenow')).toBeNull();
      expect(fill?.style.width).toBe('0%');

      updateInstallProgressElement(root, {
        details: null,
        downloadedBytes: 3,
        isCancelling: true,
        message: 'Downloading model.bin',
        state: 'downloading',
        totalBytes: 3,
      });

      expect(track?.getAttribute('aria-valuenow')).toBe('100');
      expect(fill?.style.width).toBe('100%');
    });
  });
});
