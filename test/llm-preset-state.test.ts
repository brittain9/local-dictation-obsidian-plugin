import { describe, expect, it, vi } from 'vitest';

import {
  areLlmPresetStatesEqual,
  LlmPresetStateStore,
  readLlmPresetState,
  withLlmPresetState,
} from '../src/settings/llm-preset-state';
import {
  DEFAULT_PLUGIN_SETTINGS,
  type PluginSettings,
} from '../src/settings/plugin-settings';
import { createUserPreset } from './fixtures/llm';

function settings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return { ...DEFAULT_PLUGIN_SETTINGS, ...overrides };
}

function createStore(args: {
  current?: PluginSettings;
  loadData?: () => Promise<unknown>;
}) {
  let current = args.current ?? settings();
  const commit = vi.fn(async (next: PluginSettings) => {
    current = next;
  });
  const onExternalChange = vi.fn();
  const warn = vi.fn();
  const loadData = vi.fn(args.loadData ?? (async () => current));
  const store = new LlmPresetStateStore({
    commit,
    getSettings: () => current,
    loadData,
    onExternalChange,
    warn,
  });

  return {
    commit,
    getCurrent: () => current,
    loadData,
    onExternalChange,
    store,
    warn,
  };
}

describe('LLM preset state helpers', () => {
  it('reads and reapplies only the preset-owned fields', () => {
    const preset = createUserPreset({ id: 'a' });
    const original = settings({
      developerMode: false,
      llmPostprocessActivePresetRef: 'user:a',
      llmPostprocessUserPresets: [preset],
    });
    const state = readLlmPresetState(original);
    const next = withLlmPresetState(
      { ...original, developerMode: true, llmPostprocessUserPresets: [] },
      state,
    );

    expect(state).toEqual({ activePresetRef: 'user:a', userPresets: [preset] });
    expect(next.developerMode).toBe(true);
    expect(next.llmPostprocessActivePresetRef).toBe('user:a');
    expect(next.llmPostprocessUserPresets).toEqual([preset]);
  });

  it('compares every persisted preset field and preserves array order', () => {
    const first = createUserPreset({
      description: 'description',
      id: 'a',
      overrides: { minWords: 3, temperature: 0.4, useNoteContext: true },
      timing: 'batch',
    });
    const second = createUserPreset({ id: 'b', label: 'Second' });
    const base = { activePresetRef: 'user:a', userPresets: [first, second] };

    expect(areLlmPresetStatesEqual(base, structuredClone(base))).toBe(true);
    expect(
      areLlmPresetStatesEqual(base, { ...base, activePresetRef: 'user:b' }),
    ).toBe(false);
    expect(
      areLlmPresetStatesEqual(base, { ...base, userPresets: [second, first] }),
    ).toBe(false);
    expect(
      areLlmPresetStatesEqual(base, {
        ...base,
        userPresets: [{ ...first, prompt: 'Changed prompt' }, second],
      }),
    ).toBe(false);
    expect(
      areLlmPresetStatesEqual(base, {
        ...base,
        userPresets: [
          { ...first, overrides: { ...first.overrides, temperature: 0.5 } },
          second,
        ],
      }),
    ).toBe(false);
  });
});

describe('LlmPresetStateStore.synchronize', () => {
  it('imports external preset additions while preserving unrelated memory settings', async () => {
    const externalPreset = createUserPreset({ id: 'external' });
    const fixture = createStore({
      current: settings({ developerMode: true }),
      loadData: async () => ({
        ...DEFAULT_PLUGIN_SETTINGS,
        developerMode: false,
        llmPostprocessActivePresetRef: 'user:external',
        llmPostprocessUserPresets: [externalPreset],
      }),
    });

    await fixture.store.synchronize();

    expect(fixture.getCurrent()).toMatchObject({
      developerMode: true,
      llmPostprocessActivePresetRef: 'user:external',
      llmPostprocessUserPresets: [externalPreset],
    });
    expect(fixture.commit).toHaveBeenCalledWith(expect.any(Object), { persist: false });
    expect(fixture.onExternalChange).toHaveBeenCalledTimes(1);
  });

  it('imports external edits and deletions as authoritative preset state', async () => {
    const original = createUserPreset({ id: 'a', label: 'Original' });
    const edited = createUserPreset({ id: 'a', label: 'Edited' });
    const fixture = createStore({
      current: settings({
        llmPostprocessActivePresetRef: 'user:a',
        llmPostprocessUserPresets: [original, createUserPreset({ id: 'deleted' })],
      }),
      loadData: async () => ({
        ...DEFAULT_PLUGIN_SETTINGS,
        llmPostprocessActivePresetRef: 'user:a',
        llmPostprocessUserPresets: [edited],
      }),
    });

    await fixture.store.synchronize();

    expect(readLlmPresetState(fixture.getCurrent())).toEqual({
      activePresetRef: 'user:a',
      userPresets: [edited],
    });
  });

  it('normalizes invalid external preset data before applying it', async () => {
    const fixture = createStore({
      loadData: async () => ({
        llmPostprocessActivePresetRef: 'user:valid',
        llmPostprocessUserPresets: [
          { id: '', label: 'Invalid', output: 'replace', prompt: 'Drop me' },
          {
            id: 'valid',
            label: ' Valid ',
            output: 'add_below',
            prompt: 'Reflect.',
            timing: 'per_utterance',
          },
        ],
      }),
    });

    await fixture.store.synchronize();

    expect(readLlmPresetState(fixture.getCurrent())).toEqual({
      activePresetRef: 'user:valid',
      userPresets: [
        {
          id: 'valid',
          label: 'Valid',
          output: 'add_below',
          prompt: 'Reflect.',
          timing: 'batch',
        },
      ],
    });
  });

  it('does nothing when normalized preset state is unchanged', async () => {
    const preset = createUserPreset({ id: 'same' });
    const current = settings({
      llmPostprocessActivePresetRef: 'user:same',
      llmPostprocessUserPresets: [preset],
    });
    const fixture = createStore({ current, loadData: async () => structuredClone(current) });

    await fixture.store.synchronize();

    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.onExternalChange).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent reads', async () => {
    let resolveLoad: ((value: unknown) => void) | undefined;
    const loadData = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const fixture = createStore({ loadData });

    const first = fixture.store.synchronize();
    const second = fixture.store.synchronize();
    expect(first).toBe(second);
    await Promise.resolve();
    expect(loadData).toHaveBeenCalledTimes(1);

    resolveLoad?.(DEFAULT_PLUGIN_SETTINGS);
    await Promise.all([first, second]);
  });

  it('preserves current state and logs when a read fails', async () => {
    const current = settings({
      llmPostprocessUserPresets: [createUserPreset({ id: 'keep' })],
    });
    const fixture = createStore({
      current,
      loadData: async () => {
        throw new Error('broken JSON');
      },
    });

    await expect(fixture.store.synchronize()).resolves.toBeUndefined();

    expect(fixture.getCurrent()).toBe(current);
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.warn).toHaveBeenCalledWith(
      'Failed to synchronize presets from data.json',
      expect.any(Error),
    );
  });
});

describe('LlmPresetStateStore.mutate', () => {
  it('reloads first and mutates the latest external preset state', async () => {
    const external = createUserPreset({ id: 'external' });
    const fixture = createStore({
      current: settings(),
      loadData: async () => ({
        ...DEFAULT_PLUGIN_SETTINGS,
        llmPostprocessUserPresets: [external],
      }),
    });

    await fixture.store.mutate((state) => ({
      ...state,
      activePresetRef: 'user:external',
    }));

    expect(readLlmPresetState(fixture.getCurrent())).toEqual({
      activePresetRef: 'user:external',
      userPresets: [external],
    });
    expect(fixture.commit).toHaveBeenLastCalledWith(expect.any(Object), { persist: true });
  });

  it('normalizes mutation output before persisting', async () => {
    const fixture = createStore({});

    await fixture.store.mutate(() => ({
      activePresetRef: 'user:new',
      userPresets: [
        {
          id: 'new',
          label: ' New ',
          output: 'add_above',
          prompt: 'Summarize.',
          timing: 'per_utterance',
        },
      ],
    }));

    expect(readLlmPresetState(fixture.getCurrent())).toEqual({
      activePresetRef: 'user:new',
      userPresets: [
        {
          id: 'new',
          label: 'New',
          output: 'add_above',
          prompt: 'Summarize.',
          timing: 'batch',
        },
      ],
    });
  });

  it('preserves current presets when an ordinary save starts from stale settings', () => {
    const currentPreset = createUserPreset({ id: 'current' });
    const fixture = createStore({
      current: settings({
        llmPostprocessActivePresetRef: 'user:current',
        llmPostprocessUserPresets: [currentPreset],
      }),
    });
    const stale = settings({
      developerMode: true,
      llmPostprocessActivePresetRef: 'builtin:clean-up',
      llmPostprocessUserPresets: [],
    });

    const preserved = fixture.store.preserveCurrentState(stale);

    expect(preserved.developerMode).toBe(true);
    expect(readLlmPresetState(preserved)).toEqual({
      activePresetRef: 'user:current',
      userPresets: [currentPreset],
    });
  });
});
