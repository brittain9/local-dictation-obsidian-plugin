import 'obsidian';

declare module 'obsidian' {
  interface Plugin {
    settings?: unknown;
  }

  interface PluginSettingTab {
    getSettingDefinitions(): never[];
  }
}
