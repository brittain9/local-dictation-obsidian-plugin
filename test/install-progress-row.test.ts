import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderActiveInstallCard } from '../src/settings/install-progress-row';
import { Setting, TestElement } from './__mocks__/obsidian';

const progressMock = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../src/models/model-install-progress', () => ({
  createInstallProgressElement: (...args: unknown[]) => progressMock.create(...args),
  updateInstallProgressElement: (...args: unknown[]) => progressMock.update(...args),
}));

let originalCreateFragment: typeof globalThis.createFragment;

beforeEach(() => {
  Setting.reset();
  progressMock.create.mockReset();
  progressMock.create.mockImplementation(() => new TestElement());
  progressMock.update.mockClear();
  originalCreateFragment = globalThis.createFragment;
  globalThis.createFragment = () => ({ append: vi.fn() }) as unknown as DocumentFragment;
});

afterEach(() => {
  globalThis.createFragment = originalCreateFragment;
});

describe('renderActiveInstallCard', () => {
  it('updates progress, title, and cancellation controls without replacing the row', () => {
    const parent = new TestElement();
    const onCancel = vi.fn();
    const card = renderActiveInstallCard(parent as unknown as HTMLElement, {
      isCancelling: false,
      name: 'Installing: CPU sidecar',
      onCancel,
      progressState: progressState(false),
    });
    const setting = Setting.named('Installing: CPU sidecar');
    const cancelButton = setting.buttonComponents[0];
    const settingElement = setting.settingEl;

    card.update({
      isCancelling: true,
      name: 'Installing: CUDA sidecar',
      onCancel,
      progressState: progressState(true),
    });

    expect(setting.settingEl).toBe(settingElement);
    expect(setting.name).toBe('Installing: CUDA sidecar');
    expect(cancelButton?.text).toBe('Cancelling...');
    expect(cancelButton?.disabled).toBe(true);
    expect(progressMock.update).toHaveBeenCalledWith(card.progressEl, progressState(true));
  });
});

function progressState(isCancelling: boolean) {
  return {
    details: null,
    downloadedBytes: 10,
    isCancelling,
    message: null,
    state: 'downloading' as const,
    totalBytes: 100,
  };
}
