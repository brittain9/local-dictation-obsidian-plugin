import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LLM_BUILTIN_PRESETS, type LlmPresetEntry } from '../src/llm/presets';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { PresetManagerModal } from '../src/ui/preset-manager-modal';
import type { PresetSearchHit } from '../src/ui/preset-search';
import { Setting, TestElement } from './__mocks__/obsidian';

describe('PresetManagerModal row interaction', () => {
  beforeEach(() => {
    Setting.reset();
    vi.stubGlobal('createFragment', () => new TestElement());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the information area as the explicit mouse target', async () => {
    const { entry, openEntry, row } = renderPresetRow();

    expect(row.infoEl.tabIndex).toBe(0);
    expect(row.infoEl.getAttribute('role')).toBe('button');
    expect(row.infoEl.getAttribute('aria-label')).toBe('View preset: Clean up');

    await row.settingEl.click();
    expect(openEntry).not.toHaveBeenCalled();

    await row.infoEl.click();
    expect(openEntry).toHaveBeenCalledWith(entry);
  });

  it.each(['Enter', ' '])('opens a preset with the %j key', (key) => {
    const { entry, openEntry, row } = renderPresetRow();
    const preventDefault = vi.fn();

    row.infoEl.dispatchEvent({ key, preventDefault, type: 'keydown' });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openEntry).toHaveBeenCalledWith(entry);
  });
});

function renderPresetRow(): {
  entry: LlmPresetEntry;
  openEntry: ReturnType<typeof vi.fn>;
  row: Setting;
} {
  const entry: LlmPresetEntry = {
    isBuiltin: true,
    preset: LLM_BUILTIN_PRESETS[0],
    ref: 'builtin:clean-up',
  };
  const hit: PresetSearchHit = {
    description: entry.preset.description ?? '',
    descriptionMatches: null,
    entry,
    labelMatches: null,
  };
  const openEntry = vi.fn();
  const modal = Object.create(PresetManagerModal.prototype) as {
    deps: { getSettings: () => typeof DEFAULT_PLUGIN_SETTINGS };
    openEntry: (entry: LlmPresetEntry) => void;
    renderListSection(
      listEl: HTMLElement,
      heading: string,
      hits: PresetSearchHit[],
      activeRef: string,
    ): void;
  };
  modal.deps = { getSettings: () => DEFAULT_PLUGIN_SETTINGS };
  modal.openEntry = openEntry;
  modal.renderListSection(
    new TestElement() as unknown as HTMLElement,
    'Built-in',
    [hit],
    'builtin:not-active',
  );

  return { entry, openEntry, row: Setting.named('Clean up') };
}
