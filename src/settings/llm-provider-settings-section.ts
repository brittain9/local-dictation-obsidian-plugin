import { Notice, Setting } from 'obsidian';

import {
  createProvider,
  formatLlmProviderName,
  getActiveLlmModel,
  type LlmProviderId,
  type ModelOption,
  ProviderError,
  type ProviderHealth,
  withActiveProviderModel,
} from '../llm/provider';
import type { PluginLogger } from '../shared/plugin-logger';
import { findClosestModelId, providerHealthFromError } from '../ui/llm-provider-ui';
import { isLlmProvider, type PluginSettings } from './plugin-settings';
import type { SettingAccess } from './setting-helpers';

interface LlmProviderSettingsSectionDependencies {
  access: SettingAccess;
  logger?: PluginLogger | undefined;
  refreshSettingsTab: () => void;
  saveSettings: (settings: PluginSettings) => Promise<void>;
}

export class LlmProviderSettingsSection {
  private models: ModelOption[] = [];
  private modelsProviderId: LlmProviderId | null = null;
  private modelsRefreshInFlight = false;
  private openRouterCatalog: ModelOption[] | null = null;
  private openRouterCheckMessage: string | null = null;
  private providerHealth: ProviderHealth = { kind: 'unknown' };

  constructor(private readonly dependencies: LlmProviderSettingsSectionDependencies) {}

  render(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent)
      .setName('Provider')
      .setDesc('Choose where LLM transformation runs.')
      .addDropdown((dropdown) => {
        for (const providerId of ['ollama', 'openrouter', 'gemini'] as const) {
          dropdown.addOption(providerId, formatLlmProviderName(providerId));
        }
        dropdown.setValue(settings.llmProvider);
        dropdown.onChange(async (value) => {
          if (!isLlmProvider(value)) return;
          this.models = [];
          this.modelsProviderId = null;
          this.providerHealth = { kind: 'unknown' };
          this.openRouterCheckMessage = null;
          await this.dependencies.access.persistOne('llmProvider', value);
          this.dependencies.refreshSettingsTab();
        });
      });

    switch (settings.llmProvider) {
      case 'ollama':
        this.renderModelDropdown(parent, settings);
        return;
      case 'openrouter':
        this.renderApiKey(parent, settings, {
          key: 'llmOpenRouterApiKey',
          name: 'OpenRouter API key',
          placeholder: 'sk-or-...',
        });
        this.renderOpenRouterModel(parent, settings);
        return;
      case 'gemini':
        this.renderApiKey(parent, settings, {
          key: 'llmGeminiApiKey',
          name: 'Gemini API key',
          placeholder: 'AIza...',
        });
        this.renderModelDropdown(parent, settings);
        return;
    }
  }

  private renderModelDropdown(parent: HTMLElement, settings: PluginSettings): void {
    const selectedModel = getActiveLlmModel(settings);
    const providerName = formatLlmProviderName(settings.llmProvider);
    const hasSelectedModel =
      selectedModel.length > 0 &&
      this.modelsProviderId === settings.llmProvider &&
      this.models.some((model) => model.id === selectedModel);

    new Setting(parent)
      .setName(`${providerName} model`)
      .setDesc(formatSettingsProviderHealth(this.providerHealth, settings.llmProvider))
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'Select a model');
        if (selectedModel.length > 0 && !hasSelectedModel) {
          dropdown.addOption(selectedModel, selectedModel);
        }
        if (this.modelsProviderId === settings.llmProvider) {
          for (const model of this.models) {
            dropdown.addOption(model.id, model.displayName);
          }
        }
        dropdown.setValue(selectedModel);
        dropdown.onChange(async (value) => {
          await this.dependencies.saveSettings(
            withActiveProviderModel(this.dependencies.access.getSettings(), value),
          );
          this.dependencies.refreshSettingsTab();
        });
      })
      .addExtraButton((button) => {
        button
          .setIcon('refresh-cw')
          .setTooltip(`Refresh ${providerName} models`)
          .onClick(() => {
            void this.refreshModels();
          });
      });

    if (
      this.modelsProviderId !== settings.llmProvider &&
      !this.modelsRefreshInFlight &&
      (settings.llmProvider !== 'gemini' || settings.llmGeminiApiKey.length > 0)
    ) {
      void this.refreshModels({ silent: true });
    }
  }

  private renderApiKey(
    parent: HTMLElement,
    settings: PluginSettings,
    options: {
      key: 'llmGeminiApiKey' | 'llmOpenRouterApiKey';
      name: string;
      placeholder: string;
    },
  ): void {
    new Setting(parent)
      .setName(options.name)
      .setDesc('Stored in plain text in your vault.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder(options.placeholder);
        text.setValue(settings[options.key]);
        text.onChange(async (value) => {
          this.models = [];
          this.modelsProviderId = null;
          this.providerHealth = { kind: 'unknown' };
          await this.dependencies.access.persistOne(options.key, value.trim());
        });
      });
  }

  private renderOpenRouterModel(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent)
      .setName('OpenRouter model')
      .setDesc(this.openRouterCheckMessage ?? 'Enter an OpenRouter model id.')
      .addText((text) => {
        text.setPlaceholder('anthropic/claude-sonnet-4.5');
        text.setValue(getActiveLlmModel(settings));
        text.onChange(async (value) => {
          this.openRouterCheckMessage = null;
          await this.dependencies.saveSettings(
            withActiveProviderModel(this.dependencies.access.getSettings(), value),
          );
        });
      })
      .addButton((button) => {
        button.setButtonText('Check').onClick(() => {
          void this.checkOpenRouterModel();
        });
      });
  }

  private async refreshModels(options: { silent?: boolean } = {}): Promise<void> {
    if (this.modelsRefreshInFlight) return;
    this.modelsRefreshInFlight = true;

    const settings = this.dependencies.access.getSettings();
    const providerName = formatLlmProviderName(settings.llmProvider);
    try {
      const models = await createProvider(settings).listModels();
      this.models = models;
      this.modelsProviderId = settings.llmProvider;
      this.providerHealth =
        models.length === 0 ? { kind: 'no_models' } : { kind: 'ready', modelCount: models.length };
    } catch (error) {
      this.models = [];
      this.modelsProviderId = settings.llmProvider;
      this.providerHealth = providerHealthFromError(error);
      this.dependencies.logger?.warn('llm', `${providerName} refresh failed`, error);
      if (options.silent !== true) {
        new Notice(`Local Dictation: ${providerName} is unavailable.`);
      }
    } finally {
      this.modelsRefreshInFlight = false;
    }

    this.dependencies.refreshSettingsTab();
  }

  private async checkOpenRouterModel(): Promise<void> {
    const settings = this.dependencies.access.getSettings();
    if (settings.llmProvider !== 'openrouter') return;

    const selectedModel = getActiveLlmModel(settings);
    if (selectedModel.length === 0) {
      this.openRouterCheckMessage = 'Enter a model id first.';
      this.dependencies.refreshSettingsTab();
      return;
    }

    try {
      const catalog = this.openRouterCatalog ?? (await createProvider(settings).listModels());
      this.openRouterCatalog = catalog;
      this.models = catalog;
      this.modelsProviderId = 'openrouter';
      this.providerHealth =
        catalog.length === 0
          ? { kind: 'no_models' }
          : { kind: 'ready', modelCount: catalog.length };
      if (catalog.some((model) => model.id === selectedModel)) {
        this.openRouterCheckMessage = 'Model verified.';
      } else {
        const suggestion = findClosestModelId(selectedModel, catalog);
        this.openRouterCheckMessage =
          suggestion === null ? 'Unknown model.' : `Unknown model. Did you mean ${suggestion}?`;
      }
    } catch (error) {
      this.providerHealth = providerHealthFromError(error);
      this.openRouterCheckMessage =
        error instanceof ProviderError ? error.message : 'Could not check model.';
      this.dependencies.logger?.warn('llm', 'OpenRouter model check failed', error);
    }

    this.dependencies.refreshSettingsTab();
  }
}

function formatSettingsProviderHealth(health: ProviderHealth, providerId: LlmProviderId): string {
  switch (health.kind) {
    case 'unknown':
      return providerId === 'gemini' ? 'Refresh models after entering a key.' : 'Status unknown.';
    case 'unreachable':
      return providerId === 'ollama' ? 'Not running.' : 'Unreachable.';
    case 'auth_invalid':
      return 'API key rejected.';
    case 'rate_limited':
      return 'Rate limit hit.';
    case 'no_models':
      return providerId === 'ollama'
        ? 'Running, but no chat models installed.'
        : 'No usable models found.';
    case 'ready':
      return `Ready (${health.modelCount} model${health.modelCount === 1 ? '' : 's'}).`;
  }
}
