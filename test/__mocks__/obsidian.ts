import { vi } from 'vitest';

export const getLanguage = vi.fn(() => 'en');

export abstract class AbstractInputSuggest<T> {
  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
  limit = 100;
  setValue(_value: string): void {}
  getValue(): string {
    return '';
  }
  close(): void {}
}

export class TestElement {
  readonly attributes = new Map<string, string>();
  readonly children: TestElement[] = [];
  className = '';
  disabled = false;
  id = '';
  innerHTML = '';
  readonly style: Record<string, string> = {};
  textContent = '';
  private readonly listeners = new Map<string, Array<() => unknown>>();

  get classList(): {
    add: (className: string) => void;
    toggle: (className: string, force?: boolean) => void;
  } {
    return {
      add: (className) => {
        this.addClass(className);
      },
      toggle: (className, force) => {
        this.toggleClass(className, force);
      },
    };
  }

  addClass(className: string): void {
    this.className = [this.className, className].filter(Boolean).join(' ');
  }

  addEventListener(event: string, listener: () => unknown): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  append(...children: TestElement[]): void {
    this.children.push(...children);
  }

  async click(): Promise<void> {
    for (const listener of this.listeners.get('click') ?? []) {
      await listener();
    }
    await Promise.resolve();
  }

  createDiv(options: TestElementOptions = {}): TestElement {
    return this.createEl('div', options);
  }

  createEl(_tag: string, options: TestElementOptions = {}): TestElement {
    const element = new TestElement();
    element.className = options.cls ?? '';
    element.textContent = options.text ?? '';
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.children.push(element);
    return element;
  }

  createSpan(options: TestElementOptions = {}): TestElement {
    return this.createEl('span', options);
  }

  empty(): void {
    this.children.length = 0;
    this.innerHTML = '';
    this.textContent = '';
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  findByClass(className: string): TestElement | undefined {
    if (this.className.split(/\s+/u).includes(className)) {
      return this;
    }
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match !== undefined) return match;
    }
    return undefined;
  }

  findByText(text: string): TestElement | undefined {
    if (this.textContent === text) return this;
    for (const child of this.children) {
      const match = child.findByText(text);
      if (match !== undefined) return match;
    }
    return undefined;
  }

  insertBefore(child: TestElement, before: TestElement): TestElement {
    const existingIndex = this.children.indexOf(child);
    if (existingIndex >= 0) this.children.splice(existingIndex, 1);
    const beforeIndex = this.children.indexOf(before);
    if (beforeIndex < 0) throw new Error('Reference child not found');
    this.children.splice(beforeIndex, 0, child);
    return child;
  }

  removeChild(child: TestElement): TestElement {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error('Child not found');
    this.children.splice(index, 1);
    return child;
  }

  querySelector<T>(): T | null {
    return null;
  }

  setText(text: string): void {
    this.textContent = text;
  }

  toggleAttribute(name: string, force?: boolean): void {
    const enabled = force ?? !this.attributes.has(name);
    if (enabled) {
      this.attributes.set(name, '');
    } else {
      this.attributes.delete(name);
    }
  }

  toggleClass(className: string, force?: boolean): void {
    const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
    const enabled = force ?? !classes.has(className);
    if (enabled) {
      classes.add(className);
    } else {
      classes.delete(className);
    }
    this.className = [...classes].join(' ');
  }
}

interface TestElementOptions {
  attr?: Record<string, string>;
  cls?: string;
  text?: string;
}

export class TestInputElement extends TestElement {
  inputMode = '';
  max = '';
  min = '';
  step = '';
  type = 'text';
  validationMessage = '';
  value = '';

  setCustomValidity(message: string): void {
    this.validationMessage = message;
  }
}

export class TextComponent {
  readonly inputEl = new TestInputElement();
  private changeHandler: (value: string) => unknown = () => {};

  change(value: string): void {
    this.inputEl.value = value;
    this.changeHandler(value);
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeHandler = callback;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.inputEl.disabled = disabled;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
}

export class ButtonComponent {
  readonly buttonEl = new TestElement();
  disabled = false;
  text = '';
  private clickHandler: () => unknown = () => {};

  async click(): Promise<void> {
    if (this.disabled) return;
    await this.clickHandler();
    await Promise.resolve();
  }

  onClick(callback: () => unknown): this {
    this.clickHandler = callback;
    return this;
  }

  setButtonText(text: string): this {
    this.text = text;
    this.buttonEl.textContent = text;
    return this;
  }

  setCta(): this {
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.buttonEl.disabled = disabled;
    return this;
  }

  setWarning(): this {
    return this;
  }
}

export class ExtraButtonComponent extends ButtonComponent {
  readonly extraSettingsEl = new TestElement();
  icon = '';
  tooltip = '';

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  setTooltip(tooltip: string): this {
    this.tooltip = tooltip;
    return this;
  }
}

interface TestSelectOption {
  disabled: boolean;
  label: string;
  value: string;
}

class TestSelectElement extends TestElement {
  readonly options: TestSelectOption[] = [];
  value = '';
}

export class DropdownComponent {
  readonly selectEl = new TestSelectElement();
  private changeHandler: (value: string) => unknown = () => {};

  addOption(value: string, label: string): this {
    this.selectEl.options.push({ disabled: false, label, value });
    return this;
  }

  change(value: string): void {
    this.selectEl.value = value;
    this.changeHandler(value);
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeHandler = callback;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.selectEl.disabled = disabled;
    return this;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }
}

export class ToggleComponent {
  readonly toggleEl = new TestInputElement();
  private changeHandler: (value: boolean) => unknown = () => {};
  value = false;

  change(value: boolean): void {
    this.value = value;
    this.changeHandler(value);
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.changeHandler = callback;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.toggleEl.disabled = disabled;
    return this;
  }

  setValue(value: boolean): this {
    this.value = value;
    return this;
  }
}

export class Setting {
  static readonly instances: Setting[] = [];

  readonly buttonComponents: ButtonComponent[] = [];
  readonly controlEl = new TestElement();
  readonly descEl = new TestElement();
  readonly dropdownComponents: DropdownComponent[] = [];
  readonly extraButtonComponents: ExtraButtonComponent[] = [];
  readonly nameEl = new TestElement();
  readonly settingEl = new TestElement();
  readonly textComponents: TextComponent[] = [];
  readonly toggleComponents: ToggleComponent[] = [];
  name = '';

  constructor(parent?: TestElement) {
    parent?.children.push(this.settingEl);
    Setting.instances.push(this);
  }

  static buttonNamed(name: string): ButtonComponent {
    const button = Setting.instances
      .flatMap((setting) => setting.buttonComponents)
      .find((candidate) => candidate.text === name);
    if (button === undefined) throw new Error(`Button not found: ${name}`);
    return button;
  }

  static named(name: string): Setting {
    const setting = Setting.instances.find((candidate) => candidate.name === name);
    if (setting === undefined) throw new Error(`Setting not found: ${name}`);
    return setting;
  }

  static reset(): void {
    Setting.instances.length = 0;
  }

  addButton(callback: (button: ButtonComponent) => void): this {
    const button = new ButtonComponent();
    this.buttonComponents.push(button);
    callback(button);
    return this;
  }

  addDropdown(callback: (dropdown: DropdownComponent) => void): this {
    const dropdown = new DropdownComponent();
    this.dropdownComponents.push(dropdown);
    callback(dropdown);
    return this;
  }

  addExtraButton(callback: (button: ExtraButtonComponent) => void): this {
    const button = new ExtraButtonComponent();
    this.extraButtonComponents.push(button);
    callback(button);
    return this;
  }

  addText(callback: (text: TextComponent) => void): this {
    const text = new TextComponent();
    this.textComponents.push(text);
    callback(text);
    return this;
  }

  addToggle(callback: (toggle: ToggleComponent) => void): this {
    const toggle = new ToggleComponent();
    this.toggleComponents.push(toggle);
    callback(toggle);
    return this;
  }

  onlyDropdown(): DropdownComponent {
    if (this.dropdownComponents.length !== 1) {
      throw new Error(`Expected one dropdown component for ${this.name}`);
    }
    return this.dropdownComponents[0] as DropdownComponent;
  }

  onlyText(): TextComponent {
    if (this.textComponents.length !== 1) {
      throw new Error(`Expected one text component for ${this.name}`);
    }
    return this.textComponents[0] as TextComponent;
  }

  onlyToggle(): ToggleComponent {
    if (this.toggleComponents.length !== 1) {
      throw new Error(`Expected one toggle component for ${this.name}`);
    }
    return this.toggleComponents[0] as ToggleComponent;
  }

  setDesc(description: string): this {
    this.descEl.setText(description);
    return this;
  }

  setHeading(): this {
    return this;
  }

  setName(name: string): this {
    this.name = name;
    this.nameEl.setText(name);
    return this;
  }
}

export class Modal {
  static readonly instances: Modal[] = [];
  readonly contentEl = new TestElement();
  readonly modalEl = new TestElement();
  readonly titleEl = new TestElement();

  constructor(readonly app: unknown) {
    Modal.instances.push(this);
  }

  close(): void {
    this.onClose();
  }

  onClose(): void {}

  onOpen(): void {}

  open(): void {
    this.onOpen();
  }
}

export class PluginSettingTab {
  readonly containerEl = new TestElement();

  constructor(
    readonly app: unknown,
    readonly plugin: unknown,
  ) {}
}

export class ItemView {
  readonly app: unknown;
  readonly contentEl = new TestElement();

  constructor(readonly leaf: { app?: unknown }) {
    this.app = leaf.app ?? {};
  }

  registerDomEvent(): void {}
}

export class SecretComponent {
  constructor(
    readonly app: unknown,
    readonly containerEl: HTMLElement,
  ) {}
  setValue(_value: string): this {
    return this;
  }
  onChange(_callback: (value: string) => unknown): this {
    return this;
  }
}

export const Platform = {
  isMacOS: false,
  isWin: false,
  isLinux: true,
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
};

export class Notice {
  static instances: Array<{ message: string }> = [];
  constructor(public readonly message: string) {
    Notice.instances.push({ message });
  }
}

/**
 * Tracked spy: tests can assert on calls (`expect(setIcon).toHaveBeenCalledWith`)
 * and the side effect mirrors the real Obsidian API's contract of replacing the
 * parent's child SVG. The stub markup uses a data-icon attribute so assertions
 * like `element.innerHTML.includes('data-icon="mic"')` are exact.
 */
export const setIcon = vi.fn((parent: unknown, iconId: string): void => {
  if (parent && typeof parent === 'object' && 'innerHTML' in parent) {
    (parent as { innerHTML: string }).innerHTML = `<svg data-icon="${iconId}"></svg>`;
  }
});
