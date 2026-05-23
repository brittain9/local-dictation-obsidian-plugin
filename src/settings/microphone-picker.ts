import { Notice, Setting } from 'obsidian';

import type { PluginLogger } from '../shared/plugin-logger';
import type { AudioInputDevice } from './plugin-settings';
import type { SettingAccess } from './setting-helpers';

const DEFAULT_OPTION_VALUE = '__default__';
const MISSING_OPTION_VALUE = '__missing__';
const UNLABELED_OPTION_TEXT = 'Microphone (label unavailable)';
// Windows fires `devicechange` once per HID interface on a single plug action;
// 300 ms collapses those into a single re-enumeration.
const DEVICE_CHANGE_DEBOUNCE_MS = 300;

export interface MicrophonePickerDependencies {
  access: SettingAccess;
  isDictationBusy: () => boolean;
  logger?: PluginLogger | undefined;
}

export function renderMicrophonePicker(
  parent: HTMLElement,
  deps: MicrophonePickerDependencies,
): () => void {
  const setting = new Setting(parent)
    .setName('Microphone')
    .setDesc('Which microphone to use for dictation. Changes apply on the next dictation session.');

  let devices: MediaDeviceInfo[] = [];
  let selectEl: HTMLSelectElement | null = null;
  let detectButtonEl: HTMLElement | null = null;
  let disposed = false;

  function getSaved(): AudioInputDevice | null {
    return deps.access.getSettings().audioInputDevice;
  }

  function repopulate(): void {
    if (selectEl === null) {
      return;
    }

    const saved = getSaved();
    selectEl.empty();

    appendOption(selectEl, DEFAULT_OPTION_VALUE, 'Default microphone');

    let savedIsPresent = false;
    for (const device of devices) {
      const enumeratedLabel = device.label.trim();
      // If a saved device is enumerated but came back with an empty label
      // (permission revoked between sessions), keep the friendly persisted
      // name so the row isn't blank.
      const isSaved = saved !== null && saved.deviceId === device.deviceId;
      if (isSaved) {
        savedIsPresent = true;
      }
      const display =
        enumeratedLabel.length > 0
          ? enumeratedLabel
          : isSaved
            ? saved.label
            : UNLABELED_OPTION_TEXT;
      appendOption(selectEl, device.deviceId, display);
    }

    if (saved !== null && !savedIsPresent) {
      appendOption(selectEl, MISSING_OPTION_VALUE, `${saved.label} (not connected)`);
      selectEl.value = MISSING_OPTION_VALUE;
    } else if (saved !== null) {
      selectEl.value = saved.deviceId;
    } else {
      selectEl.value = DEFAULT_OPTION_VALUE;
    }

    refreshDetectButton();
  }

  function refreshDetectButton(): void {
    if (detectButtonEl === null) {
      return;
    }
    const needsPriming = devices.length > 0 && devices.every((device) => device.label === '');
    detectButtonEl.style.display = needsPriming ? '' : 'none';
  }

  async function enumerate(): Promise<void> {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (mediaDevices?.enumerateDevices === undefined) {
      devices = [];
      repopulate();
      return;
    }

    try {
      const all = await mediaDevices.enumerateDevices();
      if (disposed) {
        return;
      }
      devices = all.filter((device) => device.kind === 'audioinput');
      repopulate();
    } catch (error) {
      deps.logger?.warn('audio', 'enumerateDevices failed', error);
      devices = [];
      repopulate();
    }
  }

  setting.addDropdown((dropdown) => {
    selectEl = dropdown.selectEl;
    dropdown.onChange((value) => {
      void handleChange(value);
    });
  });

  setting.addExtraButton((button) => {
    button
      .setIcon('refresh-cw')
      .setTooltip('Detect microphones (asks for permission)')
      .onClick(() => {
        void primePermission();
      });
    detectButtonEl = button.extraSettingsEl;
    refreshDetectButton();
  });

  async function handleChange(value: string): Promise<void> {
    if (value === DEFAULT_OPTION_VALUE) {
      await deps.access.persistOne('audioInputDevice', null);
      return;
    }

    if (value === MISSING_OPTION_VALUE) {
      // The disconnected row is selected by default when the saved device is
      // absent — no-op on re-selection.
      return;
    }

    const picked = devices.find((device) => device.deviceId === value);
    if (picked === undefined) {
      return;
    }

    const label = picked.label.trim();
    if (label.length === 0) {
      // Shouldn't happen — the user can only pick an unlabeled row before
      // priming permission, and we don't want to persist a blank label.
      new Notice('Allow microphone access first to save this device.');
      const saved = getSaved();
      if (selectEl !== null) {
        selectEl.value = saved?.deviceId ?? DEFAULT_OPTION_VALUE;
      }
      return;
    }

    await deps.access.persistOne('audioInputDevice', { deviceId: picked.deviceId, label });
  }

  async function primePermission(): Promise<void> {
    if (deps.isDictationBusy()) {
      new Notice('Stop dictation to detect microphones.');
      return;
    }

    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (mediaDevices?.getUserMedia === undefined) {
      new Notice('Microphone access is not available in this runtime.');
      return;
    }

    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      await enumerate();
    } catch (error) {
      const name = (error as { name?: unknown }).name;
      if (name === 'NotAllowedError') {
        new Notice('Microphone permission denied. Grant access in your OS settings and try again.');
      } else {
        new Notice('Could not detect microphones. Check your system audio settings.');
      }
      deps.logger?.warn('audio', 'priming microphone permission failed', error);
    }
  }

  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  const onDeviceChange = (): void => {
    if (debounceHandle !== null) {
      clearTimeout(debounceHandle);
    }
    debounceHandle = setTimeout(() => {
      debounceHandle = null;
      void enumerate();
    }, DEVICE_CHANGE_DEBOUNCE_MS);
  };

  const mediaDevices = globalThis.navigator?.mediaDevices;
  mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

  void enumerate();

  return () => {
    disposed = true;
    if (debounceHandle !== null) {
      clearTimeout(debounceHandle);
      debounceHandle = null;
    }
    mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
  };
}

function appendOption(selectEl: HTMLSelectElement, value: string, text: string): void {
  const option = selectEl.createEl('option', { text });
  option.value = value;
}
