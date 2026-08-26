const FOCUSABLE_CONTROL_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface SettingsTabRefreshHost {
  containerEl: HTMLElement;
  display(): void;
  update?: () => void;
}

interface SettingsFocus {
  controlIndex: number;
  settingName: string;
}

export class SettingsTabLifecycle {
  private visible = false;

  constructor(private readonly host: SettingsTabRefreshHost) {}

  markVisible(): void {
    this.visible = true;
  }

  markHidden(): void {
    this.visible = false;
  }

  refresh(): void {
    if (!this.visible) {
      return;
    }

    const focus = captureSettingsFocus(this.host.containerEl);
    if (typeof this.host.update === 'function') {
      this.host.update();
    } else {
      this.host.display();
    }
    restoreSettingsFocus(this.host.containerEl, focus);
  }
}

function captureSettingsFocus(containerEl: HTMLElement): SettingsFocus | null {
  const activeElement = containerEl.ownerDocument.activeElement;
  if (activeElement === null || !containerEl.contains(activeElement)) {
    return null;
  }

  const settingEl = activeElement.closest('.setting-item');
  if (settingEl === null || !containerEl.contains(settingEl)) {
    return null;
  }

  const settingName = settingEl.querySelector('.setting-item-name')?.textContent?.trim() ?? '';
  if (settingName.length === 0) {
    return null;
  }

  const controls = Array.from(settingEl.querySelectorAll<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR));
  const controlIndex = controls.indexOf(activeElement as HTMLElement);
  return controlIndex < 0 ? null : { controlIndex, settingName };
}

function restoreSettingsFocus(containerEl: HTMLElement, focus: SettingsFocus | null): void {
  if (focus === null) {
    return;
  }

  for (const settingEl of containerEl.querySelectorAll<HTMLElement>('.setting-item')) {
    const settingName = settingEl.querySelector('.setting-item-name')?.textContent?.trim() ?? '';
    if (settingName !== focus.settingName) {
      continue;
    }

    const controls = settingEl.querySelectorAll<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR);
    controls[focus.controlIndex]?.focus();
    return;
  }
}
