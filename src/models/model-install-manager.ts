import {
  catalogModelSupportsLanguage,
  type DictationLanguage,
  dictationLanguageLabel,
  languageSupportIncludes,
} from '../language/dictation-language';
import type { PluginSettings } from '../settings/plugin-settings';
import type { PluginLogger } from '../shared/plugin-logger';
import type {
  CompiledAdapterInfo,
  CompiledRuntimeInfo,
  ModelInstallUpdateEvent,
  ModelProbeResultEvent,
  SidecarEvent,
  SystemInfoEvent,
} from '../sidecar/protocol';
import type { SidecarConnection } from '../sidecar/sidecar-connection';
import { resolveEngineCapabilities } from './capability-view';
import { validateExternalModelFilePath } from './external-model-file';
import {
  type CatalogModelSelection,
  type ExternalFileModelSelection,
  type InstalledModelRecord,
  type ModelCatalogRecord,
  type ModelInstallUpdateRecord,
  type ModelStoreRecord,
  matchesModelTriple,
  type SelectedModel,
  type SelectedModelCapabilities,
  selectedModelEquals,
} from './model-management-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InstallPhase = 'canceling' | 'cancelStuck' | 'installing';

export interface ActiveInstallInfo {
  installUpdate: ModelInstallUpdateRecord;
  lastError: string | null;
  phase: InstallPhase;
}

export interface FailedInstallInfo {
  artifactIds: string[] | null;
  failureId: string;
  selection: CatalogModelSelection;
}

type LoadStatus = 'error' | 'loading' | 'ready';

export interface ModelManagerState {
  activeInstall: ActiveInstallInfo | null;
  catalog: ModelCatalogRecord;
  compiledAdapters: CompiledAdapterInfo[];
  compiledRuntimes: CompiledRuntimeInfo[];
  failedInstall: FailedInstallInfo | null;
  installedModels: InstalledModelRecord[];
  loadError: string | null;
  loadStatus: LoadStatus;
  modelStore: ModelStoreRecord;
  selectedModel: SelectedModel | null;
  selectedModelCapabilities: SelectedModelCapabilities;
  selectedTtsModel: SelectedModel | null;
  selectedTtsModelCapabilities: SelectedModelCapabilities;
}

interface ModelInstallManagerDependencies {
  getSettings: () => PluginSettings;
  logger?: PluginLogger;
  saveSettings: (settings: PluginSettings) => Promise<void>;
  sidecarConnection: Pick<
    SidecarConnection,
    | 'cancelModelInstall'
    | 'getModelStore'
    | 'getSystemInfo'
    | 'installModel'
    | 'listInstalledModels'
    | 'listModelCatalog'
    | 'probeModelSelection'
    | 'removeModel'
    | 'subscribe'
  >;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function isTerminalInstallState(state: ModelInstallUpdateRecord['state']): boolean {
  return state === 'cancelled' || state === 'completed' || state === 'failed';
}

export function isCancellingPhase(phase: InstallPhase): boolean {
  return phase === 'canceling' || phase === 'cancelStuck';
}

export function createInstallLifecycleLogMessage(
  installUpdate: ModelInstallUpdateRecord,
): string | null {
  const installLabel = `${installUpdate.modelId} (${installUpdate.installId})`;

  switch (installUpdate.state) {
    case 'downloading':
      return `install ${installLabel}: download started`;
    case 'completed':
      return `install ${installLabel}: completed`;
    case 'cancelled':
      return `install ${installLabel}: cancelled`;
    case 'failed':
    case 'probing':
    case 'queued':
    case 'verifying':
      return null;
  }
}

export function createInstallId(): string {
  return `install-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CANCEL_STUCK_TIMEOUT_MS = 30_000;

const EMPTY_CATALOG: ModelCatalogRecord = {
  catalogVersion: 0,
  collections: [],
  families: [],
  models: [],
};

const EMPTY_MODEL_STORE: ModelStoreRecord = {
  overridePath: null,
  path: '',
  usingDefaultPath: true,
};

function createModelStoreOverridePayload(modelStorePathOverride: string | undefined): {
  modelStorePathOverride?: string;
} {
  return modelStorePathOverride !== undefined && modelStorePathOverride.length > 0
    ? { modelStorePathOverride }
    : {};
}

function createProbeFailureMessage(probeResult: ModelProbeResultEvent): string {
  return probeResult.details
    ? `${probeResult.message} (${probeResult.details})`
    : probeResult.message;
}

function copyCatalogSelection(selection: CatalogModelSelection): CatalogModelSelection {
  return { ...selection };
}

interface InstallRequest {
  artifactIds: string[] | null;
  installId: string;
  selection: CatalogModelSelection;
}

function createFailedInstall(request: InstallRequest): FailedInstallInfo {
  return {
    artifactIds: request.artifactIds === null ? null : [...request.artifactIds],
    failureId: request.installId,
    selection: copyCatalogSelection(request.selection),
  };
}

function copyFailedInstall(failedInstall: FailedInstallInfo): FailedInstallInfo {
  return {
    artifactIds: failedInstall.artifactIds === null ? null : [...failedInstall.artifactIds],
    failureId: failedInstall.failureId,
    selection: copyCatalogSelection(failedInstall.selection),
  };
}

// ---------------------------------------------------------------------------
// ModelInstallManager
// ---------------------------------------------------------------------------

export class ModelInstallManager {
  private activeInstall: ActiveInstallInfo | null = null;
  private cancelStuckTimer: number | null = null;
  private catalog: ModelCatalogRecord = EMPTY_CATALOG;
  private compiledAdapters: CompiledAdapterInfo[] = [];
  private compiledRuntimes: CompiledRuntimeInfo[] = [];
  private currentInstallRequest: InstallRequest | null = null;
  private failedInstall: FailedInstallInfo | null = null;
  private installedModels: InstalledModelRecord[] = [];
  private lastLoggedInstallStateKey: string | null = null;
  private readonly listeners = new Set<() => void>();
  private loadError: string | null = null;
  private loadStatus: LoadStatus = 'loading';
  private modelStore: ModelStoreRecord = EMPTY_MODEL_STORE;
  private releaseSidecarSubscription: (() => void) | null = null;
  private selectedModelCapabilities: SelectedModelCapabilities = { status: 'none' };
  private selectedTtsModelCapabilities: SelectedModelCapabilities = { status: 'none' };

  constructor(private readonly deps: ModelInstallManagerDependencies) {}

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    this.loadStatus = 'loading';
    this.loadError = null;

    // Wire up the sidecar event listener before fetching so we don't miss
    // install events that arrive during the init fetch.
    if (this.releaseSidecarSubscription === null) {
      this.releaseSidecarSubscription = this.deps.sidecarConnection.subscribe((event) => {
        this.handleSidecarEvent(event);
      });
    }

    try {
      const settings = this.deps.getSettings();
      const overridePayload = createModelStoreOverridePayload(settings.modelStorePathOverride);

      const [catalogEvent, installedEvent, modelStoreEvent, systemInfo] = await Promise.all([
        this.deps.sidecarConnection.listModelCatalog(),
        this.deps.sidecarConnection.listInstalledModels(overridePayload.modelStorePathOverride),
        this.deps.sidecarConnection.getModelStore(overridePayload.modelStorePathOverride),
        this.fetchSystemInfo(),
      ]);

      this.catalog = catalogEvent;
      this.installedModels = installedEvent.models;
      this.modelStore = modelStoreEvent;
      this.compiledRuntimes = systemInfo?.compiledRuntimes ?? [];
      this.compiledAdapters = systemInfo?.compiledAdapters ?? [];
      this.loadStatus = 'ready';
      this.loadError = null;
    } catch (error) {
      this.loadStatus = 'error';
      this.loadError = error instanceof Error ? error.message : String(error);
    }

    const persistedSelection = this.deps.getSettings().selectedModel;
    if (persistedSelection !== null) {
      const snapshot = this.deps.getSettings().selectedModelCapabilitiesSnapshot;
      if (snapshot !== null && selectedModelEquals(snapshot.selection, persistedSelection)) {
        // Trust the snapshot's successful probe instead of loading the model on
        // every startup (issue #195), but refresh its capability metadata from
        // the running sidecar. Adapter capabilities can evolve across releases
        // without making the already-probed model selection invalid.
        const currentCapabilities = resolveEngineCapabilities(
          this.compiledRuntimes,
          this.compiledAdapters,
          persistedSelection.runtimeId,
          persistedSelection.familyId,
        );
        const refreshedCapabilities =
          currentCapabilities === null
            ? snapshot.capabilities
            : {
                ...currentCapabilities,
                family: {
                  ...currentCapabilities.family,
                  supportedLanguages: snapshot.capabilities.family.supportedLanguages,
                  supportsLanguageSelection: snapshot.capabilities.family.supportsLanguageSelection,
                  supportsAutomaticLanguageDetection:
                    snapshot.capabilities.family.supportsAutomaticLanguageDetection,
                },
              };
        this.selectedModelCapabilities = {
          capabilities: refreshedCapabilities,
          selection: persistedSelection,
          status: 'ready',
        };
      } else {
        this.selectedModelCapabilities = { selection: persistedSelection, status: 'pending' };
        void this.refreshSelectedCapabilities(persistedSelection);
      }
    }

    const persistedTtsSelection = this.deps.getSettings().selectedTtsModel;
    if (persistedTtsSelection !== null) {
      const snapshot = this.deps.getSettings().selectedTtsModelCapabilitiesSnapshot;
      if (snapshot !== null && selectedModelEquals(snapshot.selection, persistedTtsSelection)) {
        this.selectedTtsModelCapabilities = {
          capabilities: snapshot.capabilities,
          selection: persistedTtsSelection,
          status: 'ready',
        };
      } else {
        this.selectedTtsModelCapabilities = {
          selection: persistedTtsSelection,
          status: 'pending',
        };
        void this.refreshSelectedCapabilities(persistedTtsSelection, 'tts');
      }
    }

    this.notify();
  }

  dispose(): void {
    if (this.cancelStuckTimer !== null) {
      window.clearTimeout(this.cancelStuckTimer);
      this.cancelStuckTimer = null;
    }

    if (this.releaseSidecarSubscription !== null) {
      this.releaseSidecarSubscription();
      this.releaseSidecarSubscription = null;
    }

    this.activeInstall = null;
    this.currentInstallRequest = null;
    this.failedInstall = null;
    this.listeners.clear();
  }

  // -----------------------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -----------------------------------------------------------------------
  // State snapshot
  // -----------------------------------------------------------------------

  getState(): Readonly<ModelManagerState> {
    return {
      activeInstall: this.activeInstall,
      catalog: this.catalog,
      compiledAdapters: this.compiledAdapters,
      compiledRuntimes: this.compiledRuntimes,
      failedInstall: this.failedInstall === null ? null : copyFailedInstall(this.failedInstall),
      installedModels: this.installedModels,
      loadError: this.loadError,
      loadStatus: this.loadStatus,
      modelStore: this.modelStore,
      selectedModel: this.deps.getSettings().selectedModel,
      selectedModelCapabilities: this.selectedModelCapabilities,
      selectedTtsModel: this.deps.getSettings().selectedTtsModel,
      selectedTtsModelCapabilities: this.selectedTtsModelCapabilities,
    };
  }

  getDictationLanguage(): DictationLanguage {
    return this.deps.getSettings().dictationLanguage;
  }

  // -----------------------------------------------------------------------
  // Install operations
  // -----------------------------------------------------------------------

  async install(
    selection: CatalogModelSelection,
    artifactIds?: string[],
  ): Promise<ModelInstallUpdateEvent> {
    if (this.activeInstall !== null || this.currentInstallRequest !== null) {
      throw new Error('Another model is already being installed.');
    }
    const model = this.catalog.models.find((candidate) =>
      matchesModelTriple(candidate, selection.runtimeId, selection.familyId, selection.modelId),
    );
    const language = this.getDictationLanguage();
    if (model?.task === 'stt' && !catalogModelSupportsLanguage(model, language)) {
      throw incompatibleLanguageError(model.displayName, language);
    }

    const request: InstallRequest = {
      artifactIds: artifactIds === undefined ? null : [...artifactIds],
      installId: createInstallId(),
      selection: copyCatalogSelection(selection),
    };
    const clearedFailure = this.failedInstall !== null;
    this.currentInstallRequest = request;
    this.failedInstall = null;
    if (clearedFailure) {
      this.notify();
    }

    this.deps.logger?.debug(
      'model',
      `initiating install for ${request.selection.runtimeId}:${request.selection.familyId}:${request.selection.modelId}`,
    );
    try {
      return await this.deps.sidecarConnection.installModel({
        familyId: request.selection.familyId,
        installId: request.installId,
        ...(request.artifactIds === null ? {} : { artifactIds: [...request.artifactIds] }),
        modelId: request.selection.modelId,
        runtimeId: request.selection.runtimeId,
        ...createModelStoreOverridePayload(this.deps.getSettings().modelStorePathOverride),
      });
    } catch (error) {
      if (this.currentInstallRequest?.installId === request.installId) {
        this.currentInstallRequest = null;
        this.clearActiveInstall(request.installId);
        this.failedInstall = createFailedInstall(request);
        this.notify();
      }
      this.deps.logger?.warn(
        'model',
        `install ${request.selection.modelId} (${request.installId}) failed before progress`,
        error,
      );
      throw error;
    }
  }

  async retryFailedInstall(expectedFailureId: string): Promise<ModelInstallUpdateEvent | null> {
    const failure = this.failedInstall;
    if (failure === null || failure.failureId !== expectedFailureId) {
      return null;
    }

    return this.install(
      copyCatalogSelection(failure.selection),
      failure.artifactIds === null ? undefined : [...failure.artifactIds],
    );
  }

  dismissFailedInstall(expectedFailureId: string): void {
    if (this.failedInstall?.failureId !== expectedFailureId) {
      return;
    }

    this.failedInstall = null;
    this.notify();
  }

  async cancel(): Promise<void> {
    const current = this.activeInstall;

    if (current === null || current.phase !== 'installing') {
      return;
    }

    // Clear any lingering timer from a prior cancel attempt.
    if (this.cancelStuckTimer !== null) {
      window.clearTimeout(this.cancelStuckTimer);
      this.cancelStuckTimer = null;
    }

    this.activeInstall = { ...current, phase: 'canceling' };
    this.notify();

    try {
      this.deps.sidecarConnection.cancelModelInstall(current.installUpdate.installId);
    } catch (error) {
      // If the cancel command itself failed and we are still tracking the same
      // install, revert to 'installing' so the user can retry.
      if (
        this.activeInstall !== null &&
        this.activeInstall.installUpdate.installId === current.installUpdate.installId
      ) {
        this.activeInstall = {
          ...this.activeInstall,
          lastError: error instanceof Error ? error.message : String(error),
          phase: 'installing',
        };
        this.notify();
      }

      throw error;
    }

    // Start the cancel-stuck timeout.
    const cancelledInstallId = current.installUpdate.installId;
    this.cancelStuckTimer = window.setTimeout(() => {
      if (
        this.activeInstall !== null &&
        this.activeInstall.installUpdate.installId === cancelledInstallId &&
        this.activeInstall.phase === 'canceling'
      ) {
        this.deps.logger?.warn(
          'model',
          `cancel appears stuck for ${cancelledInstallId}, transitioning to cancelStuck`,
        );
        this.activeInstall = { ...this.activeInstall, phase: 'cancelStuck' };
        this.notify();
      }
    }, CANCEL_STUCK_TIMEOUT_MS);
  }

  async dismissCancelStuck(): Promise<void> {
    if (this.activeInstall === null || this.activeInstall.phase !== 'cancelStuck') {
      return;
    }
    const dismissedInstallId = this.activeInstall.installUpdate.installId;

    // Refresh installed models from sidecar to check if the model actually
    // completed while we were stuck.
    const overridePayload = createModelStoreOverridePayload(
      this.deps.getSettings().modelStorePathOverride,
    );
    const installedEvent = await this.deps.sidecarConnection.listInstalledModels(
      overridePayload.modelStorePathOverride,
    );
    this.installedModels = installedEvent.models;

    // Clear the stuck timer if it is somehow still pending.
    if (this.cancelStuckTimer !== null) {
      window.clearTimeout(this.cancelStuckTimer);
      this.cancelStuckTimer = null;
    }

    this.activeInstall = null;
    if (this.currentInstallRequest?.installId === dismissedInstallId) {
      this.currentInstallRequest = null;
    }
    this.notify();
  }

  // -----------------------------------------------------------------------
  // Selection operations (independent of install state)
  // -----------------------------------------------------------------------

  async select(selection: SelectedModel): Promise<ModelProbeResultEvent> {
    const task = this.selectionTask(selection);
    const probeResult = await this.deps.sidecarConnection.probeModelSelection({
      modelSelection: selection,
      ...createModelStoreOverridePayload(this.deps.getSettings().modelStorePathOverride),
    });

    if (!probeResult.available) {
      // The user explicitly (re-)probed this exact selection and it's
      // confirmed broken now — drop any cached "ready" snapshot for it so a
      // future startup doesn't trust stale, now-incorrect capabilities.
      await this.applyProbeResultToCapabilities(selection, probeResult, task);
      await this.invalidateCapabilitiesSnapshot(selection, task);
      throw new Error(createProbeFailureMessage(probeResult));
    }

    this.deps.logger?.debug(
      'model',
      `selected ${
        selection.kind === 'catalog_model'
          ? `${selection.runtimeId}:${selection.familyId}:${selection.modelId}`
          : selection.filePath
      }`,
    );
    const currentLanguage = this.deps.getSettings().dictationLanguage;
    const languageSupport = probeResult.mergedCapabilities?.family.supportedLanguages ?? {
      kind: 'unknown' as const,
    };
    if (
      task === 'stt' &&
      !languageSupportIncludes(
        languageSupport,
        currentLanguage,
        probeResult.mergedCapabilities?.family.supportsAutomaticLanguageDetection ?? false,
      )
    ) {
      const displayName =
        probeResult.displayName ??
        (selection.kind === 'catalog_model' ? selection.modelId : selection.filePath);
      throw incompatibleLanguageError(displayName, currentLanguage);
    }
    await this.updateSettings(
      task === 'tts'
        ? {
            selectedTtsModel: selection,
            selectedTtsVoice:
              selection.kind === 'catalog_model'
                ? (this.catalog.models.find((model) =>
                    matchesModelTriple(
                      model,
                      selection.runtimeId,
                      selection.familyId,
                      selection.modelId,
                    ),
                  )?.defaultVoice ?? null)
                : null,
          }
        : { selectedModel: selection },
    );
    await this.applyProbeResultToCapabilities(selection, probeResult, task);
    return probeResult;
  }

  async remove(selection: CatalogModelSelection): Promise<void> {
    const settings = this.deps.getSettings();
    const currentSelections = [settings.selectedModel, settings.selectedTtsModel];

    if (
      currentSelections.some(
        (currentSelection) =>
          currentSelection?.kind === 'catalog_model' &&
          matchesModelTriple(
            currentSelection,
            selection.runtimeId,
            selection.familyId,
            selection.modelId,
          ),
      )
    ) {
      throw new Error('Cannot remove the currently selected model. Clear the selection first.');
    }

    if (
      this.activeInstall !== null &&
      matchesModelTriple(
        this.activeInstall.installUpdate,
        selection.runtimeId,
        selection.familyId,
        selection.modelId,
      )
    ) {
      throw new Error('This model is currently being installed and cannot be removed.');
    }

    this.deps.logger?.debug(
      'model',
      `removing ${selection.runtimeId}:${selection.familyId}:${selection.modelId}`,
    );
    const event = await this.deps.sidecarConnection.removeModel({
      familyId: selection.familyId,
      modelId: selection.modelId,
      runtimeId: selection.runtimeId,
      ...createModelStoreOverridePayload(this.deps.getSettings().modelStorePathOverride),
    });

    if (event.removed) {
      this.installedModels = this.installedModels.filter(
        (m) => !matchesModelTriple(m, selection.runtimeId, selection.familyId, selection.modelId),
      );
      this.notify();
    }
  }

  async clearSelection(): Promise<void> {
    this.deps.logger?.debug('model', 'cleared selected model');
    await this.updateSettings({ selectedModel: null, selectedModelCapabilitiesSnapshot: null });
    this.selectedModelCapabilities = { status: 'none' };
    this.notify();
  }

  async clearTtsSelection(): Promise<void> {
    this.deps.logger?.debug('model', 'cleared selected read-aloud model');
    await this.updateSettings({
      selectedTtsModel: null,
      selectedTtsModelCapabilitiesSnapshot: null,
      selectedTtsVoice: null,
    });
    this.selectedTtsModelCapabilities = { status: 'none' };
    this.notify();
  }

  async validateAndSelectExternalFile(
    filePath: string,
    engine: Pick<ExternalFileModelSelection, 'familyId' | 'runtimeId'> = {
      familyId: 'whisper',
      runtimeId: 'whisper_cpp',
    },
  ): Promise<ModelProbeResultEvent> {
    const validatedPath = await validateExternalModelFilePath(filePath, engine);
    const selection: SelectedModel = {
      familyId: engine.familyId,
      filePath: validatedPath,
      kind: 'external_file',
      runtimeId: engine.runtimeId,
    };
    return this.select(selection);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private clearActiveInstall(installId: string): void {
    if (this.activeInstall?.installUpdate.installId === installId) {
      this.activeInstall = null;
    }
  }

  private async refreshSelectedCapabilities(
    selection: SelectedModel,
    task: 'stt' | 'tts' = 'stt',
  ): Promise<void> {
    try {
      const probeResult = await this.deps.sidecarConnection.probeModelSelection({
        modelSelection: selection,
        ...createModelStoreOverridePayload(this.deps.getSettings().modelStorePathOverride),
      });
      await this.applyProbeResultToCapabilities(selection, probeResult, task);
    } catch (error) {
      this.deps.logger?.warn(
        'model',
        `failed to probe selected model capabilities: ${error instanceof Error ? error.message : String(error)}`,
      );
      const current =
        task === 'tts'
          ? this.deps.getSettings().selectedTtsModel
          : this.deps.getSettings().selectedModel;
      if (current !== null && selectedModelEquals(current, selection)) {
        this.setCapabilities(task, {
          reason: 'probe_failed',
          selection,
          status: 'unavailable',
        });
        this.notify();
      }
    }
  }

  private async applyProbeResultToCapabilities(
    selection: SelectedModel,
    probeResult: ModelProbeResultEvent,
    task: 'stt' | 'tts' = 'stt',
  ): Promise<void> {
    const current =
      task === 'tts'
        ? this.deps.getSettings().selectedTtsModel
        : this.deps.getSettings().selectedModel;
    if (current === null || !selectedModelEquals(current, selection)) {
      return;
    }

    if (probeResult.status === 'ready' && probeResult.mergedCapabilities !== null) {
      this.setCapabilities(task, {
        capabilities: probeResult.mergedCapabilities,
        selection,
        status: 'ready',
      });
      // Cache the result so a future plugin startup can trust it instead of
      // re-probing the sidecar, which would force a full model load just to
      // populate UI badges (issue #195).
      await this.updateSettings({
        ...(task === 'tts'
          ? {
              selectedTtsModelCapabilitiesSnapshot: {
                capabilities: probeResult.mergedCapabilities,
                selection,
              },
            }
          : {
              selectedModelCapabilitiesSnapshot: {
                capabilities: probeResult.mergedCapabilities,
                selection,
              },
            }),
      });
    } else if (probeResult.status === 'missing' || probeResult.status === 'invalid') {
      const details = createProbeFailureMessage(probeResult);
      this.deps.logger?.warn(
        'model',
        `selected model probe reported ${probeResult.status}`,
        details,
      );
      this.setCapabilities(task, {
        details,
        reason: probeResult.status,
        selection,
        status: 'unavailable',
      });
    } else {
      this.setCapabilities(task, {
        reason: 'probe_failed',
        selection,
        status: 'unavailable',
      });
    }

    this.notify();
  }

  private async invalidateCapabilitiesSnapshot(
    selection: SelectedModel,
    task: 'stt' | 'tts' = 'stt',
  ): Promise<void> {
    const snapshot =
      task === 'tts'
        ? this.deps.getSettings().selectedTtsModelCapabilitiesSnapshot
        : this.deps.getSettings().selectedModelCapabilitiesSnapshot;
    if (snapshot !== null && selectedModelEquals(snapshot.selection, selection)) {
      await this.updateSettings(
        task === 'tts'
          ? { selectedTtsModelCapabilitiesSnapshot: null }
          : { selectedModelCapabilitiesSnapshot: null },
      );
    }
  }

  private handleSidecarEvent(event: SidecarEvent): void {
    if (event.type !== 'model_install_update') {
      return;
    }

    const activeBeforeEvent = this.activeInstall;
    const matchedRequest =
      this.currentInstallRequest?.installId === event.installId ? this.currentInstallRequest : null;
    const canUpdateActive =
      matchedRequest !== null ||
      (this.currentInstallRequest === null && this.failedInstall === null);
    if (canUpdateActive) {
      this.activeInstall = this.resolveNextInstallState(this.activeInstall, event);
    }
    if (matchedRequest !== null && isTerminalInstallState(event.state)) {
      this.currentInstallRequest = null;
      this.failedInstall = event.state === 'failed' ? createFailedInstall(matchedRequest) : null;
    }
    const installStateKey = `${event.installId}:${event.state}`;

    if (installStateKey !== this.lastLoggedInstallStateKey) {
      const logMessage = createInstallLifecycleLogMessage(event);
      if (logMessage !== null) {
        this.deps.logger?.debug('model', logMessage);
      }
    }

    this.lastLoggedInstallStateKey = isTerminalInstallState(event.state) ? null : installStateKey;

    // Clear cancel-stuck timer on any terminal event.
    if (
      isTerminalInstallState(event.state) &&
      activeBeforeEvent?.installUpdate.installId === event.installId &&
      this.cancelStuckTimer !== null
    ) {
      window.clearTimeout(this.cancelStuckTimer);
      this.cancelStuckTimer = null;
    }

    // On completed installs, refresh the installed models list so the UI
    // reflects the new model without requiring a restart.
    if (event.state === 'completed') {
      void this.refreshAfterInstall({
        familyId: event.familyId,
        kind: 'catalog_model',
        modelId: event.modelId,
        runtimeId: event.runtimeId,
      });
      return;
    }

    this.notify();
  }

  private async refreshAfterInstall(completed?: CatalogModelSelection): Promise<void> {
    try {
      const overridePayload = createModelStoreOverridePayload(
        this.deps.getSettings().modelStorePathOverride,
      );
      const installedEvent = await this.deps.sidecarConnection.listInstalledModels(
        overridePayload.modelStorePathOverride,
      );
      this.installedModels = installedEvent.models;
    } catch (error) {
      this.deps.logger?.warn(
        'model',
        `failed to refresh installed models after install: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Auto-select on install when nothing is currently selected — new users
    // shouldn't have to figure out a second "Use" click after installing.
    const completedTask = completed === undefined ? null : this.selectionTask(completed);
    const selectedForTask =
      completedTask === 'tts'
        ? this.deps.getSettings().selectedTtsModel
        : this.deps.getSettings().selectedModel;
    if (completed !== undefined && selectedForTask === null) {
      try {
        await this.select(completed);
      } catch (error) {
        this.deps.logger?.warn(
          'model',
          `auto-select after install failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.notify();
  }

  private resolveNextInstallState(
    current: ActiveInstallInfo | null,
    installUpdate: ModelInstallUpdateEvent,
  ): ActiveInstallInfo | null {
    if (isTerminalInstallState(installUpdate.state)) {
      return current !== null && current.installUpdate.installId !== installUpdate.installId
        ? current
        : null;
    }

    // Preserve the current phase if the incoming event belongs to the same
    // install (keeps 'canceling' / 'cancelStuck' across progress ticks).
    const preservedPhase =
      current !== null && current.installUpdate.installId === installUpdate.installId
        ? current.phase
        : 'installing';

    return {
      installUpdate,
      lastError: null,
      phase: preservedPhase,
    };
  }

  private selectionTask(selection: SelectedModel): 'stt' | 'tts' {
    if (selection.kind === 'external_file') return 'stt';
    return (
      this.catalog.models.find((model) =>
        matchesModelTriple(model, selection.runtimeId, selection.familyId, selection.modelId),
      )?.task ?? 'stt'
    );
  }

  private setCapabilities(task: 'stt' | 'tts', capabilities: SelectedModelCapabilities): void {
    if (task === 'tts') {
      this.selectedTtsModelCapabilities = capabilities;
    } else {
      this.selectedModelCapabilities = capabilities;
    }
  }

  private async fetchSystemInfo(): Promise<SystemInfoEvent | null> {
    try {
      return await this.deps.sidecarConnection.getSystemInfo();
    } catch {
      return null;
    }
  }

  private async updateSettings(patch: Partial<PluginSettings>): Promise<void> {
    await this.deps.saveSettings({
      ...this.deps.getSettings(),
      ...patch,
    });
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function incompatibleLanguageError(modelName: string, language: DictationLanguage): Error {
  return new Error(
    `${modelName} does not support ${dictationLanguageLabel(language)}. Change Dictation language before installing or selecting this model.`,
  );
}
