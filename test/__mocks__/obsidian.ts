import { vi } from 'vitest';

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
  textContent = '';

  addClass(className: string): void {
    this.className = [this.className, className].filter(Boolean).join(' ');
  }

  createDiv(options: { cls?: string; text?: string } = {}): TestElement {
    return this.createEl('div', options);
  }

  createEl(_tag: string, options: { cls?: string; text?: string } = {}): TestElement {
    const element = new TestElement();
    element.className = options.cls ?? '';
    element.textContent = options.text ?? '';
    this.children.push(element);
    return element;
  }

  createSpan(options: { cls?: string; text?: string } = {}): TestElement {
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

export class Setting {
  static readonly instances: Setting[] = [];

  readonly buttonComponents: ButtonComponent[] = [];
  readonly controlEl = new TestElement();
  readonly descEl = new TestElement();
  readonly nameEl = new TestElement();
  readonly settingEl = new TestElement();
  readonly textComponents: TextComponent[] = [];
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

  addText(callback: (text: TextComponent) => void): this {
    const text = new TextComponent();
    this.textComponents.push(text);
    callback(text);
    return this;
  }

  onlyText(): TextComponent {
    if (this.textComponents.length !== 1) {
      throw new Error(`Expected one text component for ${this.name}`);
    }
    return this.textComponents[0] as TextComponent;
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
  readonly contentEl = new TestElement();
  readonly titleEl = new TestElement();

  constructor(readonly app: unknown) {}

  close(): void {
    this.onClose();
  }

  onClose(): void {}

  onOpen(): void {}

  open(): void {
    this.onOpen();
  }
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
