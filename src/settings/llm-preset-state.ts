import type { LlmPreset } from '../llm/presets';
import { isRecord } from '../shared/type-guards';
import { type PluginSettings, resolvePluginSettings } from './plugin-settings';

export interface LlmPresetState {
  activePresetRef: string;
  userPresets: LlmPreset[];
}

export type LlmPresetStateMutation = (state: Readonly<LlmPresetState>) => LlmPresetState;

export interface LlmPresetStateStoreDependencies {
  commit: (settings: PluginSettings, options: { persist: boolean }) => Promise<void>;
  getSettings: () => PluginSettings;
  loadData: () => Promise<unknown>;
  onExternalChange: () => void;
  warn: (message: string, error: unknown) => void;
}

export function readLlmPresetState(settings: PluginSettings): LlmPresetState {
  return {
    activePresetRef: settings.llmPostprocessActivePresetRef,
    userPresets: settings.llmPostprocessUserPresets,
  };
}

export function withLlmPresetState(
  settings: PluginSettings,
  state: LlmPresetState,
): PluginSettings {
  return {
    ...settings,
    llmPostprocessActivePresetRef: state.activePresetRef,
    llmPostprocessUserPresets: state.userPresets,
  };
}

export function areLlmPresetStatesEqual(left: LlmPresetState, right: LlmPresetState): boolean {
  if (
    left.activePresetRef !== right.activePresetRef ||
    left.userPresets.length !== right.userPresets.length
  ) {
    return false;
  }

  return left.userPresets.every((preset, index) =>
    areLlmPresetsEqual(preset, right.userPresets[index]),
  );
}

export class LlmPresetStateStore {
  private operationTail: Promise<void> = Promise.resolve();
  private syncInFlight: Promise<void> | null = null;

  constructor(private readonly dependencies: LlmPresetStateStoreDependencies) {}

  synchronize(): Promise<void> {
    if (this.syncInFlight !== null) {
      return this.syncInFlight;
    }

    const operation = this.enqueue(() => this.synchronizeNow());
    const tracked = operation.finally(() => {
      if (this.syncInFlight === tracked) {
        this.syncInFlight = null;
      }
    });
    this.syncInFlight = tracked;
    return tracked;
  }

  mutate(mutation: LlmPresetStateMutation): Promise<void> {
    return this.enqueue(async () => {
      await this.synchronizeNow();

      const currentSettings = this.dependencies.getSettings();
      const currentState = readLlmPresetState(currentSettings);
      const normalizedSettings = resolvePluginSettings(
        withLlmPresetState(currentSettings, mutation(currentState)),
      );
      const normalizedState = readLlmPresetState(normalizedSettings);
      if (areLlmPresetStatesEqual(currentState, normalizedState)) {
        return;
      }

      await this.dependencies.commit(withLlmPresetState(currentSettings, normalizedState), {
        persist: true,
      });
    });
  }

  commitPreservingPresetState(nextSettings: PluginSettings): Promise<void> {
    return this.enqueue(async () => {
      const next = withLlmPresetState(
        nextSettings,
        readLlmPresetState(this.dependencies.getSettings()),
      );
      await this.dependencies.commit(next, { persist: true });
    });
  }

  commitPreservingPresetStateIf(
    condition: (settings: Readonly<PluginSettings>) => boolean,
    createNextSettings: (settings: Readonly<PluginSettings>) => PluginSettings,
  ): Promise<boolean> {
    return this.enqueue(async () => {
      const currentSettings = this.dependencies.getSettings();
      if (!condition(currentSettings)) {
        return false;
      }

      await this.dependencies.commit(
        withLlmPresetState(
          createNextSettings(currentSettings),
          readLlmPresetState(currentSettings),
        ),
        { persist: true },
      );
      return true;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async synchronizeNow(): Promise<void> {
    try {
      const raw = await this.dependencies.loadData();
      if (!isRecord(raw)) {
        throw new Error('Persisted plugin data is not an object');
      }
      const persisted = resolvePluginSettings(raw);
      const persistedState = readLlmPresetState(persisted);
      const currentSettings = this.dependencies.getSettings();
      if (areLlmPresetStatesEqual(readLlmPresetState(currentSettings), persistedState)) {
        return;
      }

      await this.dependencies.commit(withLlmPresetState(currentSettings, persistedState), {
        persist: false,
      });
      this.dependencies.onExternalChange();
    } catch (error) {
      this.dependencies.warn('Failed to synchronize presets from data.json', error);
    }
  }
}

function areLlmPresetsEqual(left: LlmPreset, right: LlmPreset | undefined): boolean {
  return (
    right !== undefined &&
    left.id === right.id &&
    left.label === right.label &&
    left.description === right.description &&
    left.prompt === right.prompt &&
    left.timing === right.timing &&
    left.output === right.output &&
    left.overrides?.minWords === right.overrides?.minWords &&
    left.overrides?.temperature === right.overrides?.temperature &&
    left.overrides?.useNoteContext === right.overrides?.useNoteContext
  );
}
