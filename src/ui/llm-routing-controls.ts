import {
  AbstractInputSuggest,
  type App,
  type ExtraButtonComponent,
  Notice,
  Setting,
  setIcon,
} from 'obsidian';

import { MIN_OUTPUT_TOKENS } from '../llm/output-budget';
import {
  createProvider,
  formatLlmProviderName,
  getProviderModel,
  type LlmProviderId,
  type LlmRouting,
  type ModelOption,
  ProviderError,
  type ProviderHealth,
  withProviderModel,
} from '../llm/provider';
import { isLlmRouting, type PluginSettings } from '../settings/plugin-settings';
import { appendInfoTooltip } from '../settings/setting-helpers';
import type { PluginLogger } from '../shared/plugin-logger';
import { formatCleanupFailureBanner, priceTier, providerHealthFromError } from './llm-provider-ui';
import { deriveInlineStatus, INLINE_STATUS_PRESENTATION } from './llm-status';

export interface LlmRoutingControlsDependencies {
  app: App;
  getSettings: () => PluginSettings;
  logger?: PluginLogger | undefined;
  notice?: ((message: string) => void) | undefined;
  persist: (settings: PluginSettings, options?: { rerender?: boolean }) => Promise<void>;
  requestRerender: () => void;
}

const ROUTING_SEGMENTS: ReadonlyArray<{ label: string; value: LlmRouting }> = [
  { label: 'Local', value: 'local' },
  { label: 'Remote', value: 'remote' },
  { label: 'Auto', value: 'auto' },
];

// Rough chars-per-token ratio used only for the human-readable threshold hint.
const CHARS_PER_TOKEN = 4;
const API_KEY_REFRESH_DEBOUNCE_MS = 500;
const TEST_RESULT_ICON_MS = 2500;

interface ProviderState {
  health: ProviderHealth;
  models: ModelOption[];
  modelsLoaded: boolean;
}

function emptyProviderState(): ProviderState {
  return {
    health: { kind: 'unknown' },
    models: [],
    modelsLoaded: false,
  };
}

class OpenRouterModelSuggest extends AbstractInputSuggest<ModelOption> {
  constructor(
    app: App,
    inputEl: HTMLInputElement | HTMLDivElement,
    private readonly getCatalog: () => ModelOption[],
    private readonly onChoose: (id: string) => void,
  ) {
    super(app, inputEl);
  }

  override getSuggestions(query: string): ModelOption[] {
    const q = query.trim().toLowerCase();
    const catalog = this.getCatalog();
    if (q.length === 0) {
      return catalog;
    }
    return catalog.filter(
      (model) => model.id.toLowerCase().includes(q) || model.displayName.toLowerCase().includes(q),
    );
  }

  override renderSuggestion(model: ModelOption, el: HTMLElement): void {
    const top = el.createDiv({ cls: 'local-dictation-suggest__top' });
    top.createSpan({ cls: 'local-dictation-suggest__primary', text: model.id });

    const tier = priceTier(model.pricing);
    if (tier !== null) {
      const pill = top.createSpan({
        cls: 'local-dictation-price',
        text: tier === 'free' ? 'Free' : tier,
      });
      pill.setAttribute('title', 'Approximate price tier');
      if (tier === 'free') {
        pill.addClass('local-dictation-price--free');
      } else if (tier === '$$$' || tier === '$$$$') {
        pill.addClass('local-dictation-price--premium');
      }
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

// Self-contained routing UI (Layout A): a segmented Local/Remote/Auto control
// that reveals only the active mode's provider config, plus the OpenRouter API
// key. Owns per-provider model-cache and health state; the API-key input lives
// here and nowhere else.
export class LlmRoutingControls {
  private readonly providers: Record<LlmProviderId, ProviderState> = {
    ollama: emptyProviderState(),
    openrouter: emptyProviderState(),
  };
  private apiKeyRefreshTimerId: number | null = null;
  private modelsRefreshInFlight: Partial<Record<LlmProviderId, boolean>> = {};
  private onModelInput: ((element: HTMLElement) => void) | null = null;
  private openRouterTestInFlight = false;

  constructor(private readonly dependencies: LlmRoutingControlsDependencies) {}

  // Optional hook so a host view can keep focus tracking on the freetext inputs.
  setInputTracker(tracker: (element: HTMLElement) => void): void {
    this.onModelInput = tracker;
  }

  dispose(): void {
    if (this.apiKeyRefreshTimerId !== null) {
      window.clearTimeout(this.apiKeyRefreshTimerId);
      this.apiKeyRefreshTimerId = null;
    }
  }

  // Kick off background model loads for whichever providers the current routing
  // needs, so the dropdowns are populated by the time the user looks. Called on
  // open, window focus, and routing changes — points where the outside world may
  // have changed — so it also retries providers whose last load left them
  // unhealthy (e.g. Ollama was started after the first probe).
  refreshActiveProviders(options: { forceLocal?: boolean } = {}): Promise<void> {
    const settings = this.dependencies.getSettings();
    const refreshes: Promise<void>[] = [];
    if (!settings.llmRemoteFeaturesEnabled) {
      refreshes.push(
        options.forceLocal === true
          ? this.refreshModels('ollama', { silent: true })
          : this.recheckModels('ollama'),
      );
      return Promise.all(refreshes).then(() => undefined);
    }
    if (settings.llmRouting === 'local' || settings.llmRouting === 'auto') {
      refreshes.push(
        options.forceLocal === true
          ? this.refreshModels('ollama', { silent: true })
          : this.recheckModels('ollama'),
      );
    }
    if (settings.llmRouting === 'remote' || settings.llmRouting === 'auto') {
      refreshes.push(this.recheckModels('openrouter'));
    }
    return Promise.all(refreshes).then(() => undefined);
  }

  private recheckModels(providerId: LlmProviderId): Promise<void> {
    const state = this.providers[providerId];
    if (state.modelsLoaded && state.health.kind === 'ready') {
      return Promise.resolve();
    }
    return this.refreshModels(providerId, { silent: true });
  }

  // Background warm: load a provider's catalog once. Unlike `recheckModels`,
  // this never retries a failed load — a failure triggers a re-render, and the
  // render paths below call this, so retrying here would loop.
  private warmModels(providerId: LlmProviderId): void {
    const state = this.providers[providerId];
    if (state.modelsLoaded || this.modelsRefreshInFlight[providerId] === true) {
      return;
    }
    void this.refreshModels(providerId, { silent: true });
  }

  render(parent: HTMLElement, settings: PluginSettings): void {
    if (!settings.llmRemoteFeaturesEnabled) {
      this.renderModelDropdown(parent, settings, 'ollama');
      return;
    }

    this.renderSegmentedControl(parent, settings);

    switch (settings.llmRouting) {
      case 'local':
        this.renderModelDropdown(parent, settings, 'ollama');
        return;
      case 'remote':
        this.renderApiKey(parent, settings);
        this.renderOpenRouterModel(parent, settings);
        return;
      case 'auto':
        this.renderAutoControls(parent, settings);
        return;
    }
  }

  private renderSegmentedControl(parent: HTMLElement, settings: PluginSettings): void {
    const field = parent.createDiv({ cls: 'local-dictation-route-field' });
    const segmented = field.createDiv({ cls: 'local-dictation-segmented' });
    segmented.setAttribute('role', 'group');
    for (const segment of ROUTING_SEGMENTS) {
      const isActive = settings.llmRouting === segment.value;
      const button = segmented.createEl('button', {
        cls: 'local-dictation-segmented__option',
        text: segment.label,
      });
      button.type = 'button';
      button.setAttribute('aria-pressed', String(isActive));
      button.toggleClass('is-active', isActive);
      button.addEventListener('click', () => {
        if (this.dependencies.getSettings().llmRouting === segment.value) {
          return;
        }
        void this.applyRouting(segment.value);
      });
    }

    field.createDiv({
      cls: 'local-dictation-route-field__hint',
      text: routingHint(settings.llmRouting),
    });
  }

  private async applyRouting(routing: LlmRouting): Promise<void> {
    if (!isLlmRouting(routing)) {
      return;
    }
    await this.dependencies.persist({ ...this.dependencies.getSettings(), llmRouting: routing });
    this.refreshActiveProviders();
  }

  private renderAutoControls(parent: HTMLElement, settings: PluginSettings): void {
    this.renderThreshold(parent, settings);

    this.renderLeg(parent, 'Local · Ollama');
    this.renderModelDropdown(parent, settings, 'ollama');

    this.renderLeg(parent, 'Remote · OpenRouter');
    this.renderApiKey(parent, settings);
    this.renderOpenRouterModel(parent, settings);
  }

  private renderThreshold(parent: HTMLElement, settings: PluginSettings): void {
    const setting = new Setting(parent)
      .setName('Route to OpenRouter above')
      .setDesc(thresholdDesc(settings.llmRemoteThresholdChars))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.inputMode = 'numeric';
        text.setValue(String(settings.llmRemoteThresholdChars));
        this.onModelInput?.(text.inputEl);
        text.onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isInteger(parsed)) {
            return;
          }
          setting.descEl.setText(thresholdDesc(parsed));
          await this.dependencies.persist(
            { ...this.dependencies.getSettings(), llmRemoteThresholdChars: parsed },
            { rerender: false },
          );
        });
      });

    appendInfoTooltip(
      setting,
      'Large transcripts can overflow a local model’s context or run slowly — Auto sends just those to OpenRouter.',
    );
  }

  private renderLeg(parent: HTMLElement, label: string): void {
    parent.createDiv({ cls: 'local-dictation-route-leg', text: label });
  }

  private renderModelDropdown(
    parent: HTMLElement,
    settings: PluginSettings,
    providerId: LlmProviderId,
  ): void {
    const state = this.providers[providerId];
    const selectedModel = getProviderModel(settings, providerId);
    const providerName = formatLlmProviderName(providerId);
    const hasSelectedModel =
      selectedModel.length > 0 && state.models.some((model) => model.id === selectedModel);

    new Setting(parent)
      .setName(`${providerName} model`)
      .setDesc('Pick a local Ollama chat model.')
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'Select a model');
        if (selectedModel.length > 0 && !hasSelectedModel) {
          dropdown.addOption(selectedModel, selectedModel);
        }
        for (const model of state.models) {
          dropdown.addOption(model.id, model.displayName);
        }
        dropdown.setValue(selectedModel);
        dropdown.onChange(async (value) => {
          const nextModel = value.trim();
          await this.dependencies.persist(
            withProviderModel(this.dependencies.getSettings(), providerId, nextModel),
          );
          this.prewarm(providerId, nextModel);
        });
      })
      .addExtraButton((button) => {
        button
          .setIcon('refresh-cw')
          .setTooltip(`Refresh ${providerName} models`)
          .onClick(() => {
            void this.refreshModels(providerId);
          });
        button.extraSettingsEl.setAttribute('aria-label', `Refresh ${providerName} models`);
      });

    this.renderStatusRow(parent, providerId);

    this.warmModels(providerId);
  }

  private renderApiKey(parent: HTMLElement, settings: PluginSettings): void {
    new Setting(parent)
      .setName('OpenRouter API key')
      .setDesc('Stored in plain text in your vault.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder('sk-or-...');
        text.setValue(settings.llmOpenRouterApiKey);
        this.onModelInput?.(text.inputEl);
        text.onChange(async (value) => {
          this.providers.openrouter = emptyProviderState();
          await this.dependencies.persist(
            { ...this.dependencies.getSettings(), llmOpenRouterApiKey: value.trim() },
            { rerender: false },
          );
          this.scheduleApiKeyRefresh();
        });
      });
  }

  private renderOpenRouterModel(parent: HTMLElement, settings: PluginSettings): void {
    const selectedModel = getProviderModel(settings, 'openrouter');
    // Assigned once the status row exists; the input handlers below call it after
    // each edit so the status tracks the model without a focus-stealing re-render.
    let refreshStatus: () => void = () => {};
    new Setting(parent)
      .setName('OpenRouter model')
      .setDesc('Type to search OpenRouter models.')
      .addText((text) => {
        text.setPlaceholder('anthropic/claude-sonnet-4.5');
        text.setValue(selectedModel);
        this.onModelInput?.(text.inputEl);
        // Constructing the suggest registers it with the input; AbstractInputSuggest
        // owns its own popover lifecycle, so we keep no handle.
        new OpenRouterModelSuggest(
          this.dependencies.app,
          text.inputEl,
          () => this.providers.openrouter.models,
          (id) => {
            void (async () => {
              await this.dependencies.persist(
                withProviderModel(this.dependencies.getSettings(), 'openrouter', id),
                { rerender: false },
              );
              refreshStatus();
            })();
          },
        );
        text.onChange(async (value) => {
          await this.dependencies.persist(
            withProviderModel(this.dependencies.getSettings(), 'openrouter', value),
            { rerender: false },
          );
          refreshStatus();
        });
      })
      .addExtraButton((button) => {
        button.setIcon('plug-zap').setTooltip('Test API key and model');
        button.extraSettingsEl.setAttribute('aria-label', 'Test OpenRouter API key and model');
        button.onClick(() => {
          void this.runOpenRouterTest(button);
        });
      });

    refreshStatus = this.renderStatusRow(parent, 'openrouter');

    this.warmModels('openrouter');
  }

  // Render the inline status line and return a callback that re-derives it in
  // place. The OpenRouter model field persists with `rerender: false`, so it uses
  // this to keep the status in sync with the selected model instead of relying on
  // a full settings re-render (which would steal focus from the text input).
  private renderStatusRow(parent: HTMLElement, providerId: LlmProviderId): () => void {
    const row = parent.createDiv();
    const update = (): void => {
      row.empty();
      const state = this.providers[providerId];
      const status = deriveInlineStatus({
        health: state.health,
        models: state.modelsLoaded ? state.models : [],
        providerId,
        selectedModel: getProviderModel(this.dependencies.getSettings(), providerId),
      });
      if (status === null) {
        row.className = '';
        return;
      }
      const { className, icon } = INLINE_STATUS_PRESENTATION[status.variant];
      row.className = `local-dictation-status ${className}`;
      const iconEl = row.createSpan({ cls: 'local-dictation-status__icon' });
      setIcon(iconEl, icon);
      row.createSpan({ cls: 'local-dictation-status__text', text: status.text });
    };
    update();
    return update;
  }

  // Proves the whole remote path — key, credits, and the exact model id — with a
  // minimal real completion. Returns null on success, or a user-facing failure
  // message in the same vocabulary as the cleanup-failure banner.
  async testOpenRouter(): Promise<string | null> {
    const settings = this.dependencies.getSettings();
    const model = getProviderModel(settings, 'openrouter').trim();
    if (model.length === 0) {
      return formatCleanupFailureBanner({
        code: 'model_not_configured',
        message: '',
        providerId: 'openrouter',
      });
    }

    try {
      await createProvider('openrouter', settings).cleanup({
        // The budget floor, not a tiny cap: reasoning models spend hidden
        // output tokens before the visible reply and would trip a small limit.
        maxOutputTokens: MIN_OUTPUT_TOKENS,
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
        providerId: 'openrouter',
      });
    }
  }

  private async runOpenRouterTest(button: ExtraButtonComponent): Promise<void> {
    if (this.openRouterTestInFlight) {
      return;
    }
    this.openRouterTestInFlight = true;
    button.setDisabled(true);
    try {
      const failure = await this.testOpenRouter();
      button.setIcon(failure === null ? 'check' : 'x');
      if (failure !== null) {
        this.notice(`Local Dictation: ${failure}`);
      }
      window.setTimeout(() => {
        button.setIcon('plug-zap');
      }, TEST_RESULT_ICON_MS);
    } finally {
      this.openRouterTestInFlight = false;
      button.setDisabled(false);
    }
  }

  private prewarm(providerId: LlmProviderId, modelId: string): void {
    if (modelId.length === 0) {
      return;
    }
    const provider = createProvider(providerId, this.dependencies.getSettings());
    void provider.prewarmModel?.(modelId)?.catch((error: unknown) => {
      this.dependencies.logger?.warn(
        'llm',
        `${formatLlmProviderName(providerId)} pre-warm failed`,
        error,
      );
    });
  }

  private scheduleApiKeyRefresh(): void {
    if (this.apiKeyRefreshTimerId !== null) {
      window.clearTimeout(this.apiKeyRefreshTimerId);
    }
    this.apiKeyRefreshTimerId = window.setTimeout(() => {
      this.apiKeyRefreshTimerId = null;
      if (this.dependencies.getSettings().llmOpenRouterApiKey.length === 0) {
        this.dependencies.requestRerender();
        return;
      }
      void this.refreshProviderHealth('openrouter');
    }, API_KEY_REFRESH_DEBOUNCE_MS);
  }

  private async refreshProviderHealth(providerId: LlmProviderId): Promise<void> {
    const state = this.providers[providerId];
    try {
      state.health = await createProvider(providerId, this.dependencies.getSettings()).probe();
    } catch (error) {
      state.health = providerHealthFromError(error);
    }
    this.dependencies.requestRerender();
  }

  private async refreshModels(
    providerId: LlmProviderId,
    options: { silent?: boolean } = {},
  ): Promise<void> {
    if (this.modelsRefreshInFlight[providerId] === true) {
      return;
    }
    this.modelsRefreshInFlight[providerId] = true;

    const state = this.providers[providerId];
    const providerName = formatLlmProviderName(providerId);
    try {
      const models = await createProvider(providerId, this.dependencies.getSettings()).listModels();
      state.models = models;
      state.health =
        models.length === 0 ? { kind: 'no_models' } : { kind: 'ready', modelCount: models.length };
    } catch (error) {
      state.models = [];
      state.health = providerHealthFromError(error);
      this.dependencies.logger?.warn('llm', `${providerName} refresh failed`, error);
      if (options.silent !== true) {
        this.notice(`Local Dictation: ${providerName} is unavailable.`);
      }
    } finally {
      state.modelsLoaded = true;
      this.modelsRefreshInFlight[providerId] = false;
    }

    this.dependencies.requestRerender();
  }

  private notice(message: string): void {
    if (this.dependencies.notice !== undefined) {
      this.dependencies.notice(message);
      return;
    }
    new Notice(message);
  }
}

function routingHint(routing: LlmRouting): string {
  switch (routing) {
    case 'local':
      return 'Runs entirely on your device with Ollama.';
    case 'remote':
      return 'Sends each transcript to OpenRouter for transformation.';
    case 'auto':
      return 'Stays on-device, and hands large transcripts to OpenRouter.';
  }
}

function thresholdDesc(chars: number): string {
  const tokens = Math.round(chars / CHARS_PER_TOKEN);
  return `${chars.toLocaleString()} characters  ·  ≈ ${tokens.toLocaleString()} tokens`;
}
