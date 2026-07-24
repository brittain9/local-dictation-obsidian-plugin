import { basename } from 'node:path';

import { t } from '../shared/i18n';
import type { ActiveInstallInfo, ModelManagerState } from './model-install-manager';
import {
  type CatalogModelRecord,
  getTotalModelSize,
  type InstalledModelRecord,
  type ModelCatalogRecord,
  type ModelFamilyId,
  type ModelTask,
  matchesModelTriple,
  type RuntimeId,
  type SelectedModel,
} from './model-management-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type ModelRowAction = 'install' | 'use' | 'selected' | 'cancel' | 'remove' | 'details';

export interface ModelRowState {
  model: CatalogModelRecord;
  installed: boolean;
  isSelected: boolean;
  isInstalling: boolean;
  isCanceling: boolean;
  allowedActions: ModelRowAction[];
}

export interface ModelFamilyTab {
  displayName: string;
  familyId: ModelFamilyId;
  runtimeId: RuntimeId;
  task: ModelTask;
}

export interface CurrentModelDisplay {
  displayName: string;
  engineLabel: string;
  detail: string;
  status: CurrentModelStatus;
  sourceLabel: string;
  sizeBytes: number | null;
  installLocation: string | null;
  resolvedPath: string | null;
}

export type CurrentModelStatus =
  | 'checking'
  | 'external_file'
  | 'external_validated'
  | 'installed'
  | 'not_installed'
  | 'not_selected'
  | 'unavailable';

export function deriveModelFamilyTabs(
  state: Pick<ModelManagerState, 'catalog' | 'compiledAdapters'>,
): ModelFamilyTab[] {
  return state.catalog.families.flatMap((family) => {
    const adapter = state.compiledAdapters.find(
      (candidate) =>
        candidate.runtimeId === family.runtimeId && candidate.familyId === family.familyId,
    );

    return adapter === undefined
      ? []
      : [
          {
            displayName: adapter.displayName,
            familyId: adapter.familyId,
            runtimeId: adapter.runtimeId,
            task: family.task,
          },
        ];
  });
}

// ---------------------------------------------------------------------------
// deriveModelRowStates
// ---------------------------------------------------------------------------

export function deriveModelRowStates(state: ModelManagerState): ModelRowState[] {
  const { catalog, installedModels, selectedModel, activeInstall } = state;

  return [...catalog.models].sort(compareCatalogModels).map((model) => {
    return deriveRowState(
      model,
      installedModels,
      model.task === 'tts' ? state.selectedTtsModel : selectedModel,
      activeInstall,
    );
  });
}

function deriveRowState(
  model: CatalogModelRecord,
  installedModels: InstalledModelRecord[],
  selectedModel: SelectedModel | null,
  activeInstall: ActiveInstallInfo | null,
): ModelRowState {
  const installed =
    installedModels.find((m) =>
      matchesModelTriple(m, model.runtimeId, model.familyId, model.modelId),
    ) !== undefined;

  const isSelected =
    selectedModel?.kind === 'catalog_model' &&
    matchesModelTriple(selectedModel, model.runtimeId, model.familyId, model.modelId);

  const thisInstall =
    activeInstall !== null &&
    matchesModelTriple(activeInstall.installUpdate, model.runtimeId, model.familyId, model.modelId)
      ? activeInstall
      : null;

  const isInstalling = thisInstall?.phase === 'installing';
  const isCanceling = thisInstall?.phase === 'canceling' || thisInstall?.phase === 'cancelStuck';

  const hasOtherActiveInstall = activeInstall !== null && thisInstall === null;

  const allowedActions = deriveAllowedActions({
    installed,
    isSelected,
    isInstalling,
    isCanceling,
    hasOtherActiveInstall,
  });

  return {
    model,
    installed,
    isSelected,
    isInstalling,
    isCanceling,
    allowedActions,
  };
}

function deriveAllowedActions(flags: {
  installed: boolean;
  isSelected: boolean;
  isInstalling: boolean;
  isCanceling: boolean;
  hasOtherActiveInstall: boolean;
}): ModelRowAction[] {
  const { installed, isSelected, isInstalling, isCanceling, hasOtherActiveInstall } = flags;

  // Currently canceling or cancelStuck — only details allowed.
  if (isCanceling) {
    return ['details'];
  }

  // Currently installing — cancel and details.
  if (isInstalling) {
    return ['cancel', 'details'];
  }

  // Not installing this model, and it is not installed.
  if (!installed) {
    // Another model is installing — block install.
    if (hasOtherActiveInstall) {
      return ['details'];
    }

    // No active install — offer install.
    return ['install', 'details'];
  }

  // Installed and selected.
  if (isSelected) {
    return ['selected', 'details'];
  }

  // Installed and not selected.
  return ['use', 'remove', 'details'];
}

// ---------------------------------------------------------------------------
// deriveCurrentModelDisplay
// ---------------------------------------------------------------------------

function emptyCurrentModelDisplay(): CurrentModelDisplay {
  return {
    displayName: t('models.current.noneSelected'),
    engineLabel: '',
    detail: t('models.current.noneSelectedDesc'),
    status: 'not_selected',
    sourceLabel: '',
    sizeBytes: null,
    installLocation: null,
    resolvedPath: null,
  };
}

export function deriveCurrentModelDisplay(state: ModelManagerState): CurrentModelDisplay {
  const { selectedModel, catalog, installedModels } = state;

  if (selectedModel === null) {
    return emptyCurrentModelDisplay();
  }

  if (selectedModel.kind === 'external_file') {
    const capabilities = state.selectedModelCapabilities;
    const status = deriveExternalModelStatus(capabilities);
    return {
      displayName: basename(selectedModel.filePath),
      engineLabel: resolveFamilyDisplayName(
        catalog,
        selectedModel.runtimeId,
        selectedModel.familyId,
      ),
      detail: status.detail,
      status: status.status,
      sourceLabel: t('models.current.externalFile'),
      sizeBytes: null,
      installLocation: null,
      resolvedPath: selectedModel.filePath,
    };
  }

  // catalog_model
  const catalogEntry =
    catalog.models.find((m) =>
      matchesModelTriple(m, selectedModel.runtimeId, selectedModel.familyId, selectedModel.modelId),
    ) ?? null;

  const installedModel =
    installedModels.find((m) =>
      matchesModelTriple(m, selectedModel.runtimeId, selectedModel.familyId, selectedModel.modelId),
    ) ?? null;

  const displayName = catalogEntry?.displayName ?? selectedModel.modelId;
  const engineLabel = resolveFamilyDisplayName(
    catalog,
    selectedModel.runtimeId,
    selectedModel.familyId,
  );

  const sizeBytes =
    installedModel?.totalSizeBytes ??
    (catalogEntry !== null ? getTotalModelSize(catalogEntry) : null);

  return {
    displayName,
    engineLabel,
    detail: installedModel !== null ? '' : t('models.current.managedNotInstalled'),
    status: installedModel !== null ? 'installed' : 'not_installed',
    sourceLabel: t('models.current.managedDownload'),
    sizeBytes,
    installLocation: installedModel?.installPath ?? null,
    resolvedPath: installedModel?.runtimePath ?? null,
  };
}

function deriveExternalModelStatus(
  capabilities: ModelManagerState['selectedModelCapabilities'],
): Pick<CurrentModelDisplay, 'detail' | 'status'> {
  switch (capabilities.status) {
    case 'ready':
      return {
        detail: '',
        status: 'external_validated',
      };
    case 'pending':
      return {
        detail: '',
        status: 'checking',
      };
    case 'unavailable':
      return {
        detail: t('models.current.externalUnavailableDesc'),
        status: 'unavailable',
      };
    case 'none':
      return {
        detail: t('models.current.validateBeforeDictating'),
        status: 'external_file',
      };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveFamilyDisplayName(
  catalog: ModelCatalogRecord,
  runtimeId: RuntimeId,
  familyId: ModelFamilyId,
): string {
  const record = catalog.families.find((f) => f.runtimeId === runtimeId && f.familyId === familyId);
  if (record !== undefined) {
    return record.displayName;
  }
  switch (familyId) {
    case 'cohere_transcribe':
      return 'Cohere Transcribe';
    case 'moonshine':
      return 'Moonshine';
    case 'nemotron_asr':
      return 'NVIDIA Nemotron 3.5 ASR';
    case 'pocket_tts':
      return 'Pocket TTS';
    case 'supertonic':
      return 'Supertonic 3';
    case 'whisper':
      return 'Whisper';
  }
}

function compareCatalogModels(left: CatalogModelRecord, right: CatalogModelRecord): number {
  return getTotalModelSize(left) - getTotalModelSize(right);
}
