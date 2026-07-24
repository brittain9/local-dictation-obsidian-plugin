import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  renderModelInstallFailurePanel,
  resolveFailedInstallDisplayName,
} from '../src/models/model-install-failure-panel';
import type { FailedInstallInfo } from '../src/models/model-install-manager';
import { Setting, TestElement } from './__mocks__/obsidian';
import { sampleCatalog } from './fixtures/catalog';
import { sampleSelection } from './fixtures/models';

function sampleFailure(overrides: Partial<FailedInstallInfo> = {}): FailedInstallInfo {
  return {
    artifactIds: ['voice-alba'],
    failureId: 'install-failed',
    selection: sampleSelection(),
    ...overrides,
  };
}

describe('model install failure panel', () => {
  beforeEach(() => {
    Setting.reset();
  });

  it('renders safe localized status copy and delegates the stable failure ID', async () => {
    const container = new TestElement();
    const onDismiss = vi.fn();
    const onRetry = vi.fn();

    renderModelInstallFailurePanel(container as unknown as HTMLElement, {
      disabled: false,
      failureId: 'install-failed',
      modelName: 'Whisper Large V3 Turbo',
      onDismiss,
      onRetry,
    });

    const setting = Setting.instances[0];
    if (setting === undefined) throw new Error('Expected a failure setting');
    expect(setting.name).toBe("Couldn't install Whisper Large V3 Turbo");
    expect(setting.descEl.textContent).toBe(
      'The install did not finish. Retry the same download, or dismiss this message.',
    );
    expect(setting.settingEl.attributes.get('aria-live')).toBe('polite');
    expect(setting.settingEl.attributes.get('role')).toBe('status');
    expect(`${setting.name} ${setting.descEl.textContent}`).not.toContain('/private/models');
    expect(setting.buttonComponents.map((button) => button.text)).toEqual(['Retry', 'Dismiss']);

    await setting.buttonComponents[0]?.click();
    await setting.buttonComponents[1]?.click();

    expect(onRetry).toHaveBeenCalledWith('install-failed');
    expect(onDismiss).toHaveBeenCalledWith('install-failed');
  });

  it('updates Retry disabled and busy semantics without rebuilding the panel', () => {
    const container = new TestElement();
    const handle = renderModelInstallFailurePanel(container as unknown as HTMLElement, {
      disabled: false,
      failureId: 'install-failed',
      modelName: 'Whisper Large V3 Turbo',
      onDismiss: vi.fn(),
      onRetry: vi.fn(),
    });
    const setting = Setting.instances[0];
    if (setting === undefined) throw new Error('Expected a failure setting');
    const retry = setting.buttonComponents[0];
    if (retry === undefined) throw new Error('Expected a Retry button');

    handle.setRetryDisabled(true);

    expect(retry.disabled).toBe(true);
    expect(retry.buttonEl.attributes.has('aria-busy')).toBe(true);
    expect(container.children[0]).toBe(setting.settingEl);
  });

  it('uses the current catalog display name with a model-ID fallback', () => {
    const failure = sampleFailure();

    expect(resolveFailedInstallDisplayName(failure, sampleCatalog().models)).toBe(
      'Whisper Large V3 Turbo',
    );
    expect(resolveFailedInstallDisplayName(failure, [])).toBe('whisper_large_v3_turbo_q8_0');
  });
});
