import { Setting } from 'obsidian';

import type { PluginSettings } from './plugin-settings';

// Filters PluginSettings keys whose value type is exactly T (not just assignable
// to T). Tuple-wrapping prevents distribution and the bidirectional check rejects
// narrower unions, so e.g. addTextSetting<SettingsKeyOf<string>> won't accept
// accelerationPreference ('auto' | 'cpu_only').
export type SettingsKeyOf<T> = {
  [K in keyof PluginSettings]: [T] extends [PluginSettings[K]]
    ? [PluginSettings[K]] extends [T]
      ? K
      : never
    : never;
}[keyof PluginSettings];

export interface SettingSpec {
  name: string;
  desc: string | DocumentFragment;
  tooltip?: string;
}

export interface DropdownOption<V extends string> {
  label: string;
  value: V;
}

export interface SettingAccess {
  getSettings(): PluginSettings;
  persistOne<K extends keyof PluginSettings>(key: K, value: PluginSettings[K]): Promise<void>;
}

export function addEnumSetting<K extends keyof PluginSettings>(
  parent: HTMLElement,
  access: SettingAccess,
  spec: SettingSpec & {
    key: K;
    options: ReadonlyArray<DropdownOption<PluginSettings[K] & string>>;
    isValid: (value: unknown) => value is PluginSettings[K];
  },
): Setting {
  const setting = new Setting(parent).setName(spec.name).setDesc(spec.desc);
  setting.addDropdown((dropdown) => {
    for (const option of spec.options) {
      dropdown.addOption(option.value, option.label);
    }
    dropdown.setValue(access.getSettings()[spec.key] as unknown as string);
    dropdown.onChange(async (value) => {
      if (!spec.isValid(value)) return;
      await access.persistOne(spec.key, value);
    });
  });
  appendInfoTooltip(setting, spec.tooltip);
  return setting;
}

export function addToggleSetting<K extends SettingsKeyOf<boolean>>(
  parent: HTMLElement,
  access: SettingAccess,
  spec: SettingSpec & { key: K; onChange?: (value: boolean) => void | Promise<void> },
): Setting {
  const setting = new Setting(parent).setName(spec.name).setDesc(spec.desc);
  setting.addToggle((toggle) => {
    toggle.setValue(access.getSettings()[spec.key]);
    toggle.onChange(async (value) => {
      await access.persistOne(spec.key, value);
      await spec.onChange?.(value);
    });
  });
  appendInfoTooltip(setting, spec.tooltip);
  return setting;
}

export function addTextSetting<K extends SettingsKeyOf<string>>(
  parent: HTMLElement,
  access: SettingAccess,
  spec: SettingSpec & { key: K; placeholder?: string },
): void {
  const setting = new Setting(parent).setName(spec.name).setDesc(spec.desc);
  setting.addText((text) => {
    if (spec.placeholder !== undefined) text.setPlaceholder(spec.placeholder);
    text.setValue(access.getSettings()[spec.key]);
    text.onChange(async (value) => {
      await access.persistOne(spec.key, value.trim());
    });
  });
  appendInfoTooltip(setting, spec.tooltip);
}

export function addPositiveIntSetting<K extends SettingsKeyOf<number>>(
  parent: HTMLElement,
  access: SettingAccess,
  spec: SettingSpec & { key: K },
): void {
  const setting = new Setting(parent).setName(spec.name).setDesc(spec.desc);
  setting.addText((text) => {
    text.inputEl.type = 'number';
    text.setValue(String(access.getSettings()[spec.key]));
    text.onChange(async (value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) return;
      await access.persistOne(spec.key, parsed);
    });
  });
  appendInfoTooltip(setting, spec.tooltip);
}

export interface NumberInputOptions extends SettingSpec {
  onChange: (value: number) => void | Promise<void>;
  onElement?: (element: HTMLInputElement) => void;
  value: number;
}

export function addNumberInputSetting(parent: HTMLElement, options: NumberInputOptions): Setting {
  const setting = new Setting(parent).setName(options.name).setDesc(options.desc);
  setting.addText((text) => {
    text.inputEl.type = 'number';
    text.setValue(options.value.toString());
    options.onElement?.(text.inputEl);
    text.onChange(async (next) => {
      await options.onChange(Number(next));
    });
  });
  appendInfoTooltip(setting, options.tooltip);
  return setting;
}

export interface TextAreaOptions extends SettingSpec {
  onChange: (value: string) => void;
  onElement?: (element: HTMLTextAreaElement) => void;
  rows: number;
  value: string;
}

export function addTextAreaSetting(parent: HTMLElement, options: TextAreaOptions): Setting {
  const setting = new Setting(parent).setName(options.name).setDesc(options.desc);
  setting.addTextArea((text) => {
    text.inputEl.rows = options.rows;
    text.setValue(options.value);
    options.onElement?.(text.inputEl);
    text.onChange(options.onChange);
  });
  appendInfoTooltip(setting, options.tooltip);
  return setting;
}

export function appendInfoTooltip(setting: Setting, tooltip: string | undefined): void {
  if (tooltip === undefined) return;
  setting.addExtraButton((button) => {
    button.setIcon('info').setTooltip(tooltip);
  });
}

// Build the native Obsidian "setting-group" structure used by core settings
// tabs: a wrapper div with a heading row, then a "setting-items" sibling
// that holds the actual rows. Obsidian's bundled CSS targets this shape to
// produce the rounded card with internal dividers.
export function createSettingGroup(
  parent: HTMLElement,
  heading: string,
  tooltip?: string,
): HTMLDivElement {
  const group = parent.createDiv({ cls: 'setting-group' });
  const headingSetting = new Setting(group).setName(heading).setHeading();
  appendInfoTooltip(headingSetting, tooltip);
  return group.createDiv({ cls: 'setting-items' });
}
