import { describe, expect, it } from 'vitest';

import type { ModelInstallManager, ModelManagerState } from '../src/models/model-install-manager';
import { renderModelSection } from '../src/settings/model-settings-section';
import { Setting, TestElement } from './__mocks__/obsidian';

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
      installedModels: [],
      loadError: null,
      loadStatus: 'ready',
      modelStore: { overridePath: null, path: '/models', usingDefaultPath: true },
      selectedModel: null,
      selectedModelCapabilities: { status: 'none' },
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
});
