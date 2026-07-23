import type { App } from 'obsidian';

type SettingsHost = {
  setting?: { open?: () => void; openTabById?: (id: string) => unknown };
};

type HotkeysTab = {
  searchInputEl?: HTMLInputElement;
};

export function openFilteredHotkeySettings(
  app: App,
  query: string,
  onFailure?: (error: unknown) => void,
): boolean {
  const host = app as unknown as SettingsHost;
  try {
    if (host.setting?.open === undefined || host.setting.openTabById === undefined) {
      throw new Error('Obsidian hotkey settings are unavailable.');
    }
    host.setting.open();
    const tab = host.setting.openTabById('hotkeys') as HotkeysTab | undefined;
    if (tab?.searchInputEl === undefined) {
      throw new Error('Obsidian hotkey search is unavailable.');
    }
    tab.searchInputEl.value = query;
    tab.searchInputEl.dispatchEvent(new Event('input'));
    return true;
  } catch (error) {
    onFailure?.(error);
    return false;
  }
}
