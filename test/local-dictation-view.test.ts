import type { WorkspaceLeaf } from 'obsidian';
import { expect, it, vi } from 'vitest';

import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import { LocalDictationView } from '../src/ui/local-dictation-view';
import type { TestElement } from './__mocks__/obsidian';

it('announces the changing sidebar workflow summary as one atomic status', () => {
  const view = new LocalDictationView({ app: {} } as unknown as WorkspaceLeaf, {
    feedback: { show: vi.fn() },
    getSecret: () => '',
    getSettings: () => ({ ...DEFAULT_PLUGIN_SETTINGS, llmFeaturesEnabled: false }),
    mutatePresetState: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    synchronizePresets: vi.fn(async () => {}),
  });

  view.refresh();

  const status = (view.contentEl as unknown as TestElement).findByClass(
    'local-dictation-sidebar__summary',
  );
  expect(status?.attributes.get('role')).toBe('status');
  expect(status?.attributes.get('aria-live')).toBe('polite');
  expect(status?.attributes.get('aria-atomic')).toBe('true');
});

it('preserves the sidebar scroll position across a settings rerender', () => {
  const view = new LocalDictationView({ app: {} } as unknown as WorkspaceLeaf, {
    feedback: { show: vi.fn() },
    getSecret: () => '',
    getSettings: () => ({ ...DEFAULT_PLUGIN_SETTINGS, llmFeaturesEnabled: false }),
    mutatePresetState: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    synchronizePresets: vi.fn(async () => {}),
  });

  view.refresh();
  const content = view.contentEl as unknown as TestElement;
  content.scrollTop = 320;

  view.requestRefresh();

  expect(content.scrollTop).toBe(320);
});
