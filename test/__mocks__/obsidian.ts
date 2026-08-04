import { vi } from 'vitest';

export const getLanguage = vi.fn(() => 'en');

const elementParents = new WeakMap<TestElement, TestElement>();

export class TestDocument {
  activeElement: TestElement | null = null;

  constructor(readonly defaultView: Window = window) {}
}

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
  readonly ownerDocument: TestDocument;
  readonly style: Record<string, string> = { width: '' };
  tabIndex = -1;
  readonly tagName: string;
  textContent = '';
  readonly win: Window;
  private readonly listeners = new Map<string, Array<(event: TestEvent) => unknown>>();

  constructor(ownerDocument = new TestDocument(), tagName = 'div') {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.win = ownerDocument.defaultView;
  }

  get parentElement(): TestElement | null {
    return elementParents.get(this) ?? null;
  }

  readonly classList = {
    add: (className: string): void => {
      this.setClass(className, true);
    },
    contains: (className: string): boolean => this.classes().has(className),
    toggle: (className: string, force?: boolean): boolean => {
      const enabled = force ?? !this.classes().has(className);
      this.setClass(className, enabled);
      return enabled;
    },
  };

  addClass(className: string): void {
    this.className = [this.className, className].filter(Boolean).join(' ');
  }

  addEventListener(event: string, listener: (event: TestEvent) => unknown): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  async click(): Promise<void> {
    this.dispatchEvent({ type: 'click' });
    await Promise.resolve();
  }

  closest(selector: string): TestElement | null {
    let current: TestElement | null = this;
    while (current !== null) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  contains(element: TestElement): boolean {
    return element === this || this.children.some((child) => child.contains(element));
  }

  createDiv(options: TestElementOptions = {}): TestElement {
    return this.createEl('div', options);
  }

  createEl(tag: string, options: TestElementOptions = {}): TestElement {
    const element = new TestElement(this.ownerDocument, tag);
    element.className = options.cls ?? '';
    element.textContent = options.text ?? '';
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.append(element);
    return element;
  }

  createSpan(options: TestElementOptions = {}): TestElement {
    return this.createEl('span', options);
  }

  empty(): void {
    for (const child of this.children) {
      elementParents.delete(child);
    }
    this.children.length = 0;
    this.innerHTML = '';
    this.textContent = '';
  }

  dispatchEvent(event: TestEvent): boolean {
    event.target ??= this;
    for (const listener of this.listeners.get(event.type) ?? []) {
      void listener(event);
    }
    return true;
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  hide(): void {
    this.style.display = 'none';
  }

  append(...children: TestElement[]): void {
    for (const child of children) {
      child.remove();
      elementParents.set(child, this);
      this.children.push(child);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestElement[] {
    const matches: TestElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  remove(): void {
    const parent = elementParents.get(this);
    if (parent === undefined) return;
    parent.removeChild(this);
  }

  replaceWith(replacement: TestElement): void {
    const parent = elementParents.get(this);
    if (parent === undefined) return;
    replacement.remove();
    const index = parent.children.indexOf(this);
    if (index < 0) return;
    parent.children.splice(index, 1, replacement);
    elementParents.delete(this);
    elementParents.set(replacement, parent);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  setAttr(name: string, value: string): void {
    this.setAttribute(name, value);
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
    if (existingIndex >= 0) {
      this.children.splice(existingIndex, 1);
      elementParents.delete(child);
    } else {
      child.remove();
    }
    const beforeIndex = this.children.indexOf(before);
    if (beforeIndex < 0) throw new Error('Reference child not found');
    elementParents.set(child, this);
    this.children.splice(beforeIndex, 0, child);
    return child;
  }

  removeChild(child: TestElement): TestElement {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error('Child not found');
    this.children.splice(index, 1);
    elementParents.delete(child);
    return child;
  }

  setText(text: string): void {
    this.textContent = text;
  }

  show(): void {
    this.style.display = '';
  }

  setChildrenInPlace(children: TestElement[]): void {
    this.empty();
    this.append(...children);
  }

  toggleAttribute(name: string, force?: boolean): void {
    const enabled = force ?? !this.attributes.has(name);
    if (enabled) {
      this.attributes.set(name, '');
    } else {
      this.attributes.delete(name);
    }
  }

  toggle(show: boolean): void {
    if (show) {
      this.show();
    } else {
      this.hide();
    }
  }

  toggleClass(className: string, force?: boolean): void {
    this.classList.toggle(className, force);
  }

  private matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const candidate = part.trim();
      if (candidate.startsWith('.')) {
        return this.classList.contains(candidate.slice(1));
      }
      if (candidate === '[tabindex]:not([tabindex="-1"])') {
        return this.tabIndex >= 0;
      }

      const tag = candidate.split(':', 1)[0]?.toUpperCase();
      if (tag !== this.tagName) {
        return false;
      }
      return !candidate.includes(':not([disabled])') || !this.disabled;
    });
  }

  private classes(): Set<string> {
    return new Set(this.className.split(/\s+/u).filter(Boolean));
  }

  private setClass(className: string, enabled: boolean): void {
    const classes = this.classes();
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

interface TestEvent {
  key?: string;
  preventDefault?: () => void;
  target?: TestElement;
  type: string;
}

export class TestInputElement extends TestElement {
  inputMode = '';
  max = '';
  min = '';
  placeholder = '';
  step = '';
  type = 'text';
  validationMessage = '';
  value = '';

  constructor(ownerDocument = new TestDocument()) {
    super(ownerDocument, 'input');
  }

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

  getValue(): string {
    return this.inputEl.value;
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeHandler = callback;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.inputEl.disabled = disabled;
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
}

export class SearchComponent extends TextComponent {
  readonly clearButtonEl: TestElement;

  constructor(container = new TestElement()) {
    super();
    const searchContainer = container.createDiv({ cls: 'search-input-container' });
    searchContainer.append(this.inputEl);
    this.clearButtonEl = searchContainer.createDiv({ cls: 'search-input-clear-button' });
  }
}

export function prepareSimpleSearch(query: string) {
  const normalized = query.toLocaleLowerCase();
  return (text: string) => {
    const index = text.toLocaleLowerCase().indexOf(normalized);
    return index < 0 ? null : { matches: [[index, index + query.length]], score: 0 };
  };
}

export function renderMatches(parent: TestElement, text: string): void {
  parent.setText(text);
}

export class ButtonComponent {
  readonly buttonEl = new TestElement();
  disabled = false;
  icon = '';
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

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  setWarning(): this {
    return this;
  }
}

export class ExtraButtonComponent extends ButtonComponent {
  readonly extraSettingsEl = new TestElement();
  tooltip = '';

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

  override empty(): void {
    super.empty();
    this.options.length = 0;
  }
}

export class DropdownComponent {
  // Obsidian 1.13 fits the closed dropdown to the selected label whenever the
  // component API updates its value. Direct selectEl mutations bypass that
  // measurement, so expose the last fitted label to regression tests.
  fittedLabel = '';
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
    this.fittedLabel = this.selectEl.options.find((option) => option.value === value)?.label ?? '';
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

export class SliderComponent {
  dynamicTooltip = false;
  readonly sliderEl = new TestInputElement();
  value = 0;
  private changeHandler: (value: number) => unknown = () => {};

  change(value: number): void {
    this.value = value;
    this.changeHandler(value);
  }

  onChange(callback: (value: number) => unknown): this {
    this.changeHandler = callback;
    return this;
  }

  setDynamicTooltip(): this {
    this.dynamicTooltip = true;
    return this;
  }

  setLimits(min: number, max: number, step: number): this {
    this.sliderEl.min = String(min);
    this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }

  setValue(value: number): this {
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
  readonly infoEl = new TestElement();
  readonly nameEl = new TestElement();
  readonly settingEl = new TestElement();
  readonly sliderComponents: SliderComponent[] = [];
  readonly textComponents: TextComponent[] = [];
  readonly toggleComponents: ToggleComponent[] = [];
  name = '';

  constructor(parent?: TestElement) {
    this.settingEl.addClass('setting-item');
    this.infoEl.addClass('setting-item-info');
    this.nameEl.addClass('setting-item-name');
    this.controlEl.addClass('setting-item-control');
    this.infoEl.append(this.nameEl, this.descEl);
    this.settingEl.append(this.infoEl, this.controlEl);
    parent?.append(this.settingEl);
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

  addComponent(callback: (containerEl: TestElement) => unknown): this {
    callback(this.controlEl);
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

  addSlider(callback: (slider: SliderComponent) => void): this {
    const slider = new SliderComponent();
    this.sliderComponents.push(slider);
    callback(slider);
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

  // Obsidian accepts a string or a node here. Callers that pass a fragment build
  // real elements into it, so keep them reachable as children instead of
  // stringifying the fragment away.
  setDesc(description: string | TestElement): this {
    if (description instanceof TestElement) {
      this.descEl.append(description);
    } else {
      this.descEl.setText(description);
    }
    return this;
  }

  setClass(className: string): this {
    this.settingEl.addClass(className);
    return this;
  }

  setHeading(): this {
    return this;
  }

  setName(name: string | TestElement): this {
    if (name instanceof TestElement) {
      this.name = name.textContent;
      this.nameEl.append(name);
    } else {
      this.name = name;
      this.nameEl.setText(name);
    }
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

  setTitle(title: string): this {
    this.titleEl.setText(title);
    return this;
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

export const setTooltip = vi.fn((target: unknown, tooltip: string): void => {
  if (target && typeof target === 'object' && 'setAttribute' in target) {
    (target as { setAttribute(name: string, value: string): void }).setAttribute(
      'data-tooltip',
      tooltip,
    );
  }
});
