import { describe, expect, it, vi } from 'vitest';

import type { ModelInstallManager, ModelManagerState } from '../src/models/model-install-manager';
import { getModelStatusBadge, renderModelSection } from '../src/settings/model-settings-section';
import { Setting, TestElement } from './__mocks__/obsidian';

vi.mock('../src/shared/i18n', () => ({
  t: (key: string) =>
    ({
      'models.current.externalFile': '外部ファイル',
      'models.current.unavailable': '利用不可能',
      'settings.model.noModel': 'モデルなし',
      'settings.model.unavailable': '利用不可能',
    })[key] ?? key,
}));

describe('model settings section ownership', () => {
  it('does not erase sibling language controls when manager state changes', () => {
    const section = new TestElement();
    const modelSummary = section.createDiv();
    const languageSetting = new Setting(section).setName('Dictation language');
    let notify = () => {};
    const state: ModelManagerState = {
      activeInstall: null,
      catalog: { catalogVersion: 1, collections: [], families: [], models: [] },
      compiledAdapters: [],
      compiledRuntimes: [],
      failedInstall: null,
      installedModels: [],
      loadError: null,
      loadStatus: 'ready',
      modelStore: { overridePath: null, path: '/models', usingDefaultPath: true },
      selectedModel: null,
      selectedModelCapabilities: { status: 'none' },
      selectedTtsModel: null,
      selectedTtsModelCapabilities: { status: 'none' },
    };
    const manager = {
      getState: () => state,
      subscribe: (listener: () => void) => {
        notify = listener;
        return () => {};
      },
    } as unknown as ModelInstallManager;
    const originalCreateFragment = globalThis.createFragment;
    globalThis.createFragment = () => new TestElement() as unknown as DocumentFragment;

    try {
      renderModelSection(modelSummary as unknown as HTMLDivElement, manager, {
        onExternalFile: () => {},
        onManageModels: () => {},
        onModelInfo: null,
      });
      notify();

      expect(section.children).toContain(languageSetting.settingEl);
      expect(modelSummary.children).not.toContain(languageSetting.settingEl);
    } finally {
      globalThis.createFragment = originalCreateFragment;
    }
  });

  it('selects the badge by stable status when translations are not English', () => {
    expect(getModelStatusBadge('unavailable')).toEqual({
      modifier: 'missing',
      text: '利用不可能',
    });
    expect(getModelStatusBadge('not_selected')).toEqual({
      modifier: 'none',
      text: 'モデルなし',
    });
  });
});
