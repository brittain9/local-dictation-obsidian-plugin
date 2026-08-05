import {
  AbstractInputSuggest,
  type App,
  type ExtraButtonComponent,
  SecretComponent,
  Setting,
  setIcon,
} from 'obsidian';

import { isLoopbackHostname, validateOpenAiCompatibleBaseUrl } from '../llm/openai-compatible-url';
import {
  formatLlmProviderName,
  getProviderModel,
  LLM_PROVIDER_IDS,
  type LlmProviderId,
  type LlmRoutingPolicy,
  type ModelOption,
  ProviderError,
  type ProviderHealth,
  withOpenAiCompatibleBaseUrl,
  withProviderConfigurationModel,
  withProviderSecretId,
} from '../llm/provider';
import { createProvider } from '../llm/provider-factory';
import { resolveLlmReadiness } from '../llm/readiness';
import { activeLlmProviderIds } from '../llm/routing-policy';
import {
  DEFAULT_LLM_ROUTING_THRESHOLD_CHARS,
  MAX_LLM_ROUTING_THRESHOLD_CHARS,
  MIN_LLM_ROUTING_THRESHOLD_CHARS,
  type PluginSettings,
} from '../settings/plugin-settings';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import { describeAdvancedModelSettings } from './llm-model-settings-presentation';
import { formatCleanupFailureBanner, priceTier, providerHealthFromError } from './llm-provider-ui';
import { deriveInlineStatus, INLINE_STATUS_PRESENTATION } from './llm-status';
import { addValidatedNumberSetting } from './validated-number-setting';

export interface LlmRoutingControlsDependencies {
  app: App;
  feedback: Pick<UserFeedback, 'show'>;
  getSecret: (secretId: string) => string;
  getSettings: () => PluginSettings;
  logger?: PluginLogger | undefined;
  openModelSettings: () => void;
  persist: (settings: PluginSettings, options?: { rerender?: boolean }) => Promise<void>;
  requestRerender: () => void;
}

const SECRET_REFRESH_DEBOUNCE_MS = 500;
const TEST_RESULT_ICON_MS = 2500;
const CONNECTION_TEST_MAX_OUTPUT_TOKENS = 16;

interface ProviderState {
  health: ProviderHealth;
  models: ModelOption[];
  modelsLoaded: boolean;
}

function emptyProviderState(): ProviderState {
  return { health: { kind: 'unknown' }, models: [], modelsLoaded: false };
}

class ModelSuggest extends AbstractInputSuggest<ModelOption> {
  constructor(
    app: App,
    inputEl: HTMLInputElement | HTMLDivElement,
    private readonly getCatalog: () => ModelOption[],
    private readonly onChoose: (id: string) => void,
  ) {
    super(app, inputEl);
  }

  override getSuggestions(query: string): ModelOption[] {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) {
      return this.getCatalog();
    }
    return this.getCatalog().filter(
      (model) =>
        model.id.toLowerCase().includes(normalized) ||
        model.displayName.toLowerCase().includes(normalized),
    );
  }

  override renderSuggestion(model: ModelOption, el: HTMLElement): void {
    const top = el.createDiv({ cls: 'local-dictation-suggest__top' });
    top.createSpan({ cls: 'local-dictation-suggest__primary', text: model.id });
    const tier = priceTier(model.pricing);
    if (tier !== null) {
      const pill = top.createSpan({
        cls: 'local-dictation-price',
        text: tier === 'free' ? t('common.free') : tier,
      });
      pill.setAttribute('title', t('llm.routing.priceTierTooltip'));
      if (tier === 'free') pill.addClass('local-dictation-price--free');
      if (tier === '$$$' || tier === '$$$$') pill.addClass('local-dictation-price--premium');
    }
    if (model.displayName !== model.id) {
      el.createSpan({ cls: 'local-dictation-suggest__secondary', text: model.displayName });
    }
  }

  override selectSuggestion(model: ModelOption): void {
    this.setValue(model.id);
    this.onChoose(model.id);
    this.close();
  }
}

export class LlmRoutingControls {
  private readonly providers: Record<LlmProviderId, ProviderState> = {
    ollama: emptyProviderState(),
    openrouter: emptyProviderState(),
    openai_compatible: emptyProviderState(),
  };
  private modelsRefreshInFlight: Partial<Record<LlmProviderId, boolean>> = {};
  private onModelInput: ((element: HTMLElement) => void) | null = null;
  private secretRefreshTimerId: number | null = null;
  private readonly testsInFlight = new Set<LlmProviderId>();

  constructor(private readonly dependencies: LlmRoutingControlsDependencies) {}

  setInputTracker(tracker: (element: HTMLElement) => void): void {
    this.onModelInput = tracker;
  }

  dispose(): void {
    if (this.secretRefreshTimerId !== null) {
      window.clearTimeout(this.secretRefreshTimerId);
      this.secretRefreshTimerId = null;
    }
  }

  refreshActiveProviders(options: { forceLocal?: boolean } = {}): Promise<void> {
    const settings = this.dependencies.getSettings();
    const refreshes = activeLlmProviderIds(settings.llmRoutingPolicy).map((providerId) =>
      options.forceLocal === true && shouldForceLocalCatalogRefresh(providerId, settings)
        ? this.refreshModels(providerId)
        : this.recheckModels(providerId),
    );
    return Promise.all(refreshes).then(() => undefined);
  }

  render(parent: HTMLElement, settings: PluginSettings): void {
    this.renderProviderSelection(parent, settings);
    this.renderReadiness(parent, settings);

    const policy = settings.llmRoutingPolicy;
    if (policy === null) {
      return;
    }
    if (policy.kind === 'fixed') {
      this.renderProviderConfiguration(parent, settings, policy.providerId);
      this.renderAdvancedSettings(parent, settings);
      return;
    }

    this.renderLeg(parent, t('llm.routing.defaultLeg'));
    this.renderProviderConfiguration(parent, settings, policy.defaultProviderId);
    this.renderLeg(parent, t('llm.routing.largeLeg'));
    this.renderProviderConfiguration(parent, settings, policy.largeTranscriptProviderId);
    this.renderAdvancedSettings(parent, settings);
  }

  async testProvider(providerId: Exclude<LlmProviderId, 'ollama'>): Promise<string | null> {
    const settings = this.dependencies.getSettings();
    const model = getProviderModel(settings.llmProviderConfigurations, providerId);
    if (model.length === 0) {
      return formatCleanupFailureBanner({
        code: 'model_not_configured',
        message: '',
        providerId,
      });
    }
    if (providerId === 'openai_compatible') {
      const validation = validateOpenAiCompatibleBaseUrl(
        settings.llmProviderConfigurations.openai_compatible.baseUrl,
      );
      if (!validation.valid) {
        return customUrlValidationMessage(validation.code);
      }
    }

    try {
      await this.createProvider(providerId, settings).cleanup({
        maxOutputTokens: CONNECTION_TEST_MAX_OUTPUT_TOKENS,
        model,
        prompt: 'Reply with the single word OK.',
        temperature: 0,
        userMessage: 'ping',
      });
      return null;
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              error instanceof Error ? error.message : String(error),
              'connection_failed',
            );
      return formatCleanupFailureBanner({
        code: providerError.code,
        message: providerError.message,
        providerId,
      });
    }
  }

  private renderProviderSelection(parent: HTMLElement, settings: PluginSettings): void {
    const policy = settings.llmRoutingPolicy;
    const selectedProvider =
      policy === null ? '' : policy.kind === 'fixed' ? policy.providerId : policy.defaultProviderId;
    const name =
      policy?.kind === 'transcript_size'
        ? t('llm.routing.defaultProvider')
        : t('llm.routing.provider');

    new Setting(parent).setName(name).addDropdown((dropdown) => {
      dropdown.addOption('', t('llm.routing.chooseProvider'));
      for (const providerId of LLM_PROVIDER_IDS) {
        dropdown.addOption(providerId, providerLabel(providerId));
      }
      dropdown.setValue(selectedProvider);
      dropdown.onChange(async (value) => {
        if (value === '') {
          await this.persistPolicy(null);
          return;
        }
        if (!LLM_PROVIDER_IDS.includes(value as LlmProviderId)) {
          return;
        }
        const providerId = value as LlmProviderId;
        if (policy?.kind !== 'transcript_size') {
          await this.persistPolicy({ kind: 'fixed', providerId });
          return;
        }
        await this.persistPolicy({
          ...policy,
          defaultProviderId: providerId,
          largeTranscriptProviderId:
            policy.largeTranscriptProviderId === providerId
              ? firstOtherProvider(providerId)
              : policy.largeTranscriptProviderId,
        });
      });
    });

    if (policy !== null) {
      new Setting(parent)
        .setName(t('llm.routing.useLargeProvider'))
        .setDesc(t('llm.routing.useLargeProviderDescription'))
        .addToggle((toggle) => {
          toggle.setValue(policy.kind === 'transcript_size');
          toggle.onChange(async (enabled) => {
            const current = this.dependencies.getSettings().llmRoutingPolicy;
            if (current === null) return;
            if (!enabled) {
              await this.persistPolicy({
                kind: 'fixed',
                providerId:
                  current.kind === 'fixed' ? current.providerId : current.defaultProviderId,
              });
              return;
            }
            const defaultProviderId =
              current.kind === 'fixed' ? current.providerId : current.defaultProviderId;
            await this.persistPolicy({
              defaultProviderId,
              kind: 'transcript_size',
              largeTranscriptProviderId:
                current.kind === 'transcript_size'
                  ? current.largeTranscriptProviderId
                  : firstOtherProvider(defaultProviderId),
              thresholdChars:
                current.kind === 'transcript_size'
                  ? current.thresholdChars
                  : DEFAULT_LLM_ROUTING_THRESHOLD_CHARS,
            });
          });
        });
    }

    if (policy?.kind === 'transcript_size') {
      new Setting(parent).setName(t('llm.routing.largeProvider')).addDropdown((dropdown) => {
        for (const providerId of LLM_PROVIDER_IDS) {
          if (providerId !== policy.defaultProviderId) {
            dropdown.addOption(providerId, providerLabel(providerId));
          }
        }
        dropdown.setValue(policy.largeTranscriptProviderId);
        dropdown.onChange(async (value) => {
          if (
            !LLM_PROVIDER_IDS.includes(value as LlmProviderId) ||
            value === policy.defaultProviderId
          ) {
            return;
          }
          await this.persistPolicy({
            ...policy,
            largeTranscriptProviderId: value as LlmProviderId,
          });
        });
      });

      addValidatedNumberSetting(parent, {
        desc: t('llm.model.routingThreshold.description'),
        integer: true,
        max: MAX_LLM_ROUTING_THRESHOLD_CHARS,
        min: MIN_LLM_ROUTING_THRESHOLD_CHARS,
        name: t('llm.model.routingThreshold.name'),
        onChange: (thresholdChars) => {
          void this.persistRoutingThreshold(thresholdChars);
        },
        value: policy.thresholdChars,
      }).setClass('local-dictation-route-setting');
    }
  }

  private renderAdvancedSettings(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent)
      .setName(t('llm.model.behavior.name'))
      .setDesc(describeAdvancedModelSettings(settings))
      .addExtraButton((button) => {
        button
          .setIcon('sliders-horizontal')
          .setTooltip(t('llm.model.settingsTooltip'))
          .onClick(() => this.dependencies.openModelSettings());
        button.extraSettingsEl.setAttribute('aria-label', t('llm.model.settingsTooltip'));
      });
  }

  private renderReadiness(parent: HTMLElement, settings: PluginSettings): void {
    const readiness = resolveLlmReadiness({
      configurations: settings.llmProviderConfigurations,
      getSecret: this.dependencies.getSecret,
      policy: settings.llmRoutingPolicy,
    });
    if (readiness.ready) return;

    const row = parent.createDiv({ cls: 'local-dictation-status local-dictation-status--warning' });
    row.setAttribute('role', 'status');
    const icon = row.createSpan({ cls: 'local-dictation-status__icon' });
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, 'alert-triangle');
    row.createSpan({
      cls: 'local-dictation-status__text',
      text: readinessMessage(readiness.issue),
    });
  }

  private renderProviderConfiguration(
    parent: HTMLElement,
    settings: PluginSettings,
    providerId: LlmProviderId,
  ): void {
    switch (providerId) {
      case 'ollama':
        this.renderOllamaModel(parent, settings);
        return;
      case 'openrouter':
        this.renderSecret(parent, settings, providerId);
        this.renderEditableModel(parent, settings, providerId);
        return;
      case 'openai_compatible':
        this.renderCustomBaseUrl(parent, settings);
        this.renderSecret(parent, settings, providerId);
        this.renderEditableModel(parent, settings, providerId);
        return;
    }
  }

  private renderOllamaModel(parent: HTMLElement, settings: PluginSettings): void {
    const providerId = 'ollama';
    const state = this.providers[providerId];
    const selectedModel = getProviderModel(settings.llmProviderConfigurations, providerId);
    const hasSelectedModel = state.models.some((model) => model.id === selectedModel);
    new Setting(parent)
      .setName(t('llm.routing.providerModel', { provider: formatLlmProviderName(providerId) }))
      .setDesc(t('llm.routing.ollamaModelDescription'))
      .addDropdown((dropdown) => {
        dropdown.addOption('', t('llm.routing.selectModel'));
        if (selectedModel.length > 0 && !hasSelectedModel) {
          dropdown.addOption(selectedModel, selectedModel);
        }
        for (const model of state.models) dropdown.addOption(model.id, model.displayName);
        dropdown.setValue(selectedModel);
        dropdown.onChange(async (model) => {
          await this.persistModel(providerId, model);
          this.prewarm(model);
        });
      })
      .addExtraButton((button) => {
        button
          .setIcon('refresh-cw')
          .setTooltip(t('llm.routing.refreshModels', { provider: 'Ollama' }))
          .onClick(() => void this.refreshModels(providerId));
      });
    this.renderStatusRow(parent, providerId);
    this.warmModels(providerId);
  }

  private renderCustomBaseUrl(parent: HTMLElement, settings: PluginSettings): void {
    const config = settings.llmProviderConfigurations.openai_compatible;
    new Setting(parent)
      .setName(t('llm.routing.customBaseUrl.name'))
      .setDesc(t('llm.routing.customBaseUrl.description'))
      .addText((text) => {
        text.setPlaceholder('http://localhost:1234/v1');
        text.setValue(config.baseUrl);
        this.onModelInput?.(text.inputEl);
        text.inputEl.addEventListener('blur', () => {
          this.dependencies.requestRerender();
        });
        text.onChange(async (baseUrl) => {
          this.providers.openai_compatible = emptyProviderState();
          const current = this.dependencies.getSettings();
          await this.dependencies.persist(
            {
              ...current,
              llmProviderConfigurations: withOpenAiCompatibleBaseUrl(
                current.llmProviderConfigurations,
                baseUrl,
              ),
            },
            { rerender: false },
          );
        });
      });

    const validation = validateOpenAiCompatibleBaseUrl(config.baseUrl);
    if (!validation.valid) return;
    const url = new URL(validation.normalizedUrl);
    const destination = parent.createDiv({ cls: 'local-dictation-route-field__hint' });
    destination.setText(t('llm.routing.customDestination', { host: url.host }));
    if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
      const warning = parent.createDiv({
        cls: 'local-dictation-status local-dictation-status--warning',
      });
      warning.setText(t('llm.routing.insecureHttpWarning'));
    }
  }

  private renderSecret(
    parent: HTMLElement,
    settings: PluginSettings,
    providerId: 'openrouter' | 'openai_compatible',
  ): void {
    const configuration = settings.llmProviderConfigurations[providerId];
    new Setting(parent)
      .setName(
        providerId === 'openrouter'
          ? t('llm.routing.openRouterApiKey.name')
          : t('llm.routing.customApiKey.name'),
      )
      .setDesc(
        providerId === 'openrouter'
          ? t('llm.routing.openRouterApiKey.description')
          : t('llm.routing.customApiKey.description'),
      )
      .addComponent((containerEl) =>
        new SecretComponent(this.dependencies.app, containerEl)
          .setValue(configuration.secretId)
          .onChange(async (secretId) => {
            this.providers[providerId] = emptyProviderState();
            const current = this.dependencies.getSettings();
            await this.dependencies.persist(
              {
                ...current,
                llmProviderConfigurations: withProviderSecretId(
                  current.llmProviderConfigurations,
                  providerId,
                  secretId,
                ),
              },
              { rerender: false },
            );
            this.scheduleSecretRefresh(providerId);
          }),
      );
  }

  private renderEditableModel(
    parent: HTMLElement,
    settings: PluginSettings,
    providerId: 'openrouter' | 'openai_compatible',
  ): void {
    const selectedModel = getProviderModel(settings.llmProviderConfigurations, providerId);
    let refreshStatus: () => void = () => {};
    const setting = new Setting(parent)
      .setName(
        providerId === 'openrouter'
          ? t('llm.routing.openRouterModel.name')
          : t('llm.routing.customModel.name'),
      )
      .setDesc(
        providerId === 'openrouter'
          ? t('llm.routing.openRouterModel.description')
          : t('llm.routing.customModel.description'),
      );
    setting.setClass('local-dictation-model-setting');
    setting.addText((text) => {
      text.setPlaceholder(providerId === 'openrouter' ? 'anthropic/claude-sonnet-4.5' : 'model-id');
      text.setValue(selectedModel);
      this.onModelInput?.(text.inputEl);
      text.inputEl.addEventListener('blur', () => {
        this.dependencies.requestRerender();
      });
      if (providerId === 'openrouter') {
        new ModelSuggest(
          this.dependencies.app,
          text.inputEl,
          () => this.providers[providerId].models,
          (model) => void this.persistModel(providerId, model, false).then(refreshStatus),
        );
      } else {
        this.renderOpenAiCompatibleModelOptions(setting.controlEl, text.inputEl);
      }
      text.onChange(async (model) => {
        await this.persistModel(providerId, model, false);
        refreshStatus();
      });
    });
    if (providerId === 'openai_compatible') {
      setting.addExtraButton((button) => {
        const label = t('llm.routing.refreshModels', {
          provider: formatLlmProviderName(providerId),
        });
        button.setIcon('refresh-cw').setTooltip(label);
        button.extraSettingsEl.setAttribute('aria-label', label);
        button.onClick(() => void this.refreshModels(providerId));
      });
    }
    setting.addExtraButton((button) => {
      button.setIcon('plug-zap').setTooltip(t('llm.routing.testConnection'));
      button.extraSettingsEl.setAttribute('aria-label', t('llm.routing.testConnection'));
      button.onClick(() => void this.runConnectionTest(providerId, button));
    });
    refreshStatus = this.renderStatusRow(parent, providerId);
    this.warmModels(providerId);
  }

  private renderOpenAiCompatibleModelOptions(control: HTMLElement, input: HTMLInputElement): void {
    const listId = 'local-dictation-openai-compatible-models';
    input.setAttribute('list', listId);
    const datalist = control.createEl('datalist', { attr: { id: listId } });
    for (const model of this.providers.openai_compatible.models) {
      datalist.createEl('option', {
        attr: { label: model.displayName, value: model.id },
      });
    }
  }

  private renderStatusRow(parent: HTMLElement, providerId: LlmProviderId): () => void {
    const row = parent.createDiv();
    row.setAttribute('aria-live', 'polite');
    row.setAttribute('role', 'status');
    const update = (): void => {
      row.empty();
      const state = this.providers[providerId];
      const status = deriveInlineStatus({
        health: state.health,
        models: state.modelsLoaded ? state.models : [],
        providerId,
        selectedModel: getProviderModel(
          this.dependencies.getSettings().llmProviderConfigurations,
          providerId,
        ),
      });
      if (status === null) {
        row.className = '';
        return;
      }
      const presentation = INLINE_STATUS_PRESENTATION[status.variant];
      row.className = `local-dictation-status ${presentation.className}`;
      const icon = row.createSpan({ cls: 'local-dictation-status__icon' });
      icon.setAttribute('aria-hidden', 'true');
      setIcon(icon, presentation.icon);
      row.createSpan({ cls: 'local-dictation-status__text', text: status.text });
    };
    update();
    return update;
  }

  private renderLeg(parent: HTMLElement, label: string): void {
    parent.createDiv({ cls: 'local-dictation-route-leg', text: label });
  }

  private async persistPolicy(policy: LlmRoutingPolicy | null): Promise<void> {
    await this.dependencies.persist({
      ...this.dependencies.getSettings(),
      llmRoutingPolicy: policy,
    });
    void this.refreshActiveProviders();
  }

  private async persistRoutingThreshold(thresholdChars: number): Promise<void> {
    const current = this.dependencies.getSettings();
    if (current.llmRoutingPolicy?.kind !== 'transcript_size') return;
    await this.dependencies.persist(
      {
        ...current,
        llmRoutingPolicy: { ...current.llmRoutingPolicy, thresholdChars },
      },
      { rerender: false },
    );
  }

  private async persistModel(
    providerId: LlmProviderId,
    model: string,
    rerender = true,
  ): Promise<void> {
    const current = this.dependencies.getSettings();
    await this.dependencies.persist(
      {
        ...current,
        llmProviderConfigurations: withProviderConfigurationModel(
          current.llmProviderConfigurations,
          providerId,
          model,
        ),
      },
      { rerender },
    );
  }

  private recheckModels(providerId: LlmProviderId): Promise<void> {
    const state = this.providers[providerId];
    return state.modelsLoaded && state.health.kind === 'ready'
      ? Promise.resolve()
      : this.refreshModels(providerId);
  }

  private warmModels(providerId: LlmProviderId): void {
    const state = this.providers[providerId];
    if (state.modelsLoaded || this.modelsRefreshInFlight[providerId] === true) return;
    if (
      providerId === 'openai_compatible' &&
      !validateOpenAiCompatibleBaseUrl(
        this.dependencies.getSettings().llmProviderConfigurations.openai_compatible.baseUrl,
      ).valid
    ) {
      return;
    }
    void this.refreshModels(providerId);
  }

  private async refreshModels(providerId: LlmProviderId): Promise<void> {
    if (this.modelsRefreshInFlight[providerId] === true) return;
    if (
      providerId === 'openai_compatible' &&
      !validateOpenAiCompatibleBaseUrl(
        this.dependencies.getSettings().llmProviderConfigurations.openai_compatible.baseUrl,
      ).valid
    ) {
      return;
    }
    this.modelsRefreshInFlight[providerId] = true;
    const state = this.providers[providerId];
    try {
      const models = await this.createProvider(providerId).listModels();
      state.models = models;
      state.health =
        models.length === 0 ? { kind: 'no_models' } : { kind: 'ready', modelCount: models.length };
    } catch (error) {
      state.models = [];
      state.health = providerHealthFromError(error);
      this.dependencies.logger?.warn(
        'llm',
        `${formatLlmProviderName(providerId)} refresh failed`,
        error,
      );
    } finally {
      state.modelsLoaded = true;
      this.modelsRefreshInFlight[providerId] = false;
    }
    this.dependencies.requestRerender();
  }

  private scheduleSecretRefresh(providerId: 'openrouter' | 'openai_compatible'): void {
    if (this.secretRefreshTimerId !== null) window.clearTimeout(this.secretRefreshTimerId);
    this.secretRefreshTimerId = window.setTimeout(() => {
      this.secretRefreshTimerId = null;
      void this.refreshModels(providerId);
    }, SECRET_REFRESH_DEBOUNCE_MS);
  }

  private async runConnectionTest(
    providerId: 'openrouter' | 'openai_compatible',
    button: ExtraButtonComponent,
  ): Promise<void> {
    if (this.testsInFlight.has(providerId)) return;
    this.testsInFlight.add(providerId);
    button
      .setDisabled(true)
      .setIcon('loader-circle')
      .setTooltip(t('llm.routing.testingConnection'));
    button.extraSettingsEl.addClass('local-dictation-connection-test--loading');
    try {
      const failure = await this.testProvider(providerId);
      button.setIcon(failure === null ? 'check' : 'x');
      if (failure !== null) {
        this.dependencies.feedback.show({ intent: 'warning', message: failure });
      }
      window.setTimeout(() => {
        button.setIcon('plug-zap').setTooltip(t('llm.routing.testConnection'));
      }, TEST_RESULT_ICON_MS);
    } finally {
      this.testsInFlight.delete(providerId);
      button.extraSettingsEl.removeClass('local-dictation-connection-test--loading');
      button.setDisabled(false);
    }
  }

  private prewarm(model: string): void {
    if (model.length === 0) return;
    const provider = this.createProvider('ollama');
    void provider.prewarmModel?.(model)?.catch((error: unknown) => {
      this.dependencies.logger?.warn('llm', 'Ollama pre-warm failed', error);
    });
  }

  private createProvider(
    providerId: LlmProviderId,
    settings = this.dependencies.getSettings(),
  ): ReturnType<typeof createProvider> {
    return createProvider(providerId, {
      configurations: settings.llmProviderConfigurations,
      getSecret: this.dependencies.getSecret,
      networkTimeoutMs: settings.llmNetworkTimeoutSec * 1000,
    });
  }
}

function providerLabel(providerId: LlmProviderId): string {
  switch (providerId) {
    case 'ollama':
      return t('llm.provider.ollama');
    case 'openrouter':
      return t('llm.provider.openrouter');
    case 'openai_compatible':
      return t('llm.provider.custom');
  }
}

function firstOtherProvider(providerId: LlmProviderId): LlmProviderId {
  return LLM_PROVIDER_IDS.find((candidate) => candidate !== providerId) ?? 'ollama';
}

function shouldForceLocalCatalogRefresh(
  providerId: LlmProviderId,
  settings: PluginSettings,
): boolean {
  if (providerId === 'ollama') return true;
  if (providerId !== 'openai_compatible') return false;

  const validation = validateOpenAiCompatibleBaseUrl(
    settings.llmProviderConfigurations.openai_compatible.baseUrl,
  );
  return validation.valid && isLoopbackHostname(new URL(validation.normalizedUrl).hostname);
}

function readinessMessage(issue: {
  code: string;
  message?: string;
  providerId?: LlmProviderId;
}): string {
  switch (issue.code) {
    case 'provider_missing':
      return t('llm.readiness.chooseProvider');
    case 'model_missing':
      return t('llm.readiness.chooseModel', {
        provider: formatLlmProviderName(issue.providerId ?? 'ollama'),
      });
    case 'api_key_missing':
      return t('llm.readiness.apiKeyMissing');
    case 'base_url_invalid':
      return t('llm.readiness.baseUrlInvalid');
    default:
      return t('llm.readiness.routingInvalid');
  }
}

function customUrlValidationMessage(
  code: Exclude<ReturnType<typeof validateOpenAiCompatibleBaseUrl>, { valid: true }>['code'],
): string {
  switch (code) {
    case 'empty':
      return t('llm.validation.baseUrl.empty');
    case 'not_absolute':
      return t('llm.validation.baseUrl.absolute');
    case 'scheme':
      return t('llm.validation.baseUrl.scheme');
    case 'credentials':
      return t('llm.validation.baseUrl.credentials');
    case 'query_or_fragment':
      return t('llm.validation.baseUrl.queryOrFragment');
  }
}
