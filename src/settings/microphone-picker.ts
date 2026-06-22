import { Notice, Setting } from 'obsidian';

import { formatMicrophoneCaptureErrorMessage } from '../audio/microphone-permission-message';
import type { PluginLogger } from '../shared/plugin-logger';
import type { AudioInputDevice } from './plugin-settings';
import type { SettingAccess } from './setting-helpers';

const DEFAULT_OPTION_VALUE = '__default__';
const MISSING_OPTION_VALUE = '__missing__';
const UNLABELED_OPTION_TEXT = 'Microphone (label unavailable)';
// Chromium on Windows suffixes USB device labels with a `(VID:PID)` tuple
// (e.g. " (03f0:098d)"). It's stable but noise in a settings UI — strip it
// for display and persistence so the dropdown matches what the user sees in
// the OS sound control panel.
const VID_PID_SUFFIX = /\s*\(([0-9a-f]{4}):([0-9a-f]{4})\)\s*$/i;
// Chromium synthesizes two alias entries with these literal deviceIds that
// track whichever physical device is currently the OS default for general /
// communications routing. They duplicate real devices already in the list
// and we expose our own "Default microphone" row at the top, so hide them.
const SYNTHETIC_ALIAS_IDS = new Set(['default', 'communications']);
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
  // Bumped on every enumerate() call. Out-of-order resolutions (initial
  // enumerate vs a devicechange-debounced one) compare against this and drop
  // their result if a newer call has already started, so a stale response
  // cannot overwrite a fresher device list.
  let enumerateVersion = 0;

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
      const enumeratedLabel = formatDeviceLabel(device.label);
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
    const mediaDevices = window.navigator?.mediaDevices;
    if (mediaDevices?.getUserMedia === undefined) {
      detectButtonEl.addClass('local-stt-hidden');
      return;
    }
    // Show the button whenever no enumerated device has a usable label. That
    // covers the empty list (locked-down OS permission, no inputs visible) and
    // the labels-look-empty cases (permission not yet granted, or label is
    // only a VID:PID suffix that formatDeviceLabel strips to '').
    const hasLabeledDevice = devices.some((device) => formatDeviceLabel(device.label).length > 0);
    detectButtonEl.toggleClass('local-stt-hidden', hasLabeledDevice);
  }

  async function enumerate(): Promise<void> {
    const version = ++enumerateVersion;
    const mediaDevices = window.navigator?.mediaDevices;
    if (mediaDevices?.enumerateDevices === undefined) {
      devices = [];
      repopulate();
      return;
    }

    try {
      const all = await mediaDevices.enumerateDevices();
      if (disposed || version !== enumerateVersion) {
        return;
      }
      devices = all.filter(
        (device) => device.kind === 'audioinput' && !SYNTHETIC_ALIAS_IDS.has(device.deviceId),
      );
      repopulate();
    } catch (error) {
      if (disposed || version !== enumerateVersion) {
        return;
      }
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
      repopulate();
      return;
    }

    if (value === MISSING_OPTION_VALUE) {
      // Re-selecting the disconnected row is normally a no-op, but if the user
      // previously switched to Default in this session the saved state is null
      // and the MISSING row is an orphan. Repopulate to drop it and re-sync
      // the dropdown with saved state.
      repopulate();
      return;
    }

    const picked = devices.find((device) => device.deviceId === value);
    if (picked === undefined) {
      return;
    }

    const label = formatDeviceLabel(picked.label);
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
    repopulate();
  }

  async function primePermission(): Promise<void> {
    if (deps.isDictationBusy()) {
      new Notice('Stop dictation to detect microphones.');
      return;
    }

    const mediaDevices = window.navigator?.mediaDevices;
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
      new Notice(
        formatMicrophoneCaptureErrorMessage(error) ??
          'Could not detect microphones. Check your system audio settings.',
      );
      deps.logger?.warn('audio', 'priming microphone permission failed', error);
    }
  }

  let debounceHandle: number | null = null;
  const onDeviceChange = (): void => {
    if (debounceHandle !== null) {
      window.clearTimeout(debounceHandle);
    }
    debounceHandle = window.setTimeout(() => {
      debounceHandle = null;
      void enumerate();
    }, DEVICE_CHANGE_DEBOUNCE_MS);
  };

  const mediaDevices = window.navigator?.mediaDevices;
  mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

  void enumerate();

  return () => {
    disposed = true;
    if (debounceHandle !== null) {
      window.clearTimeout(debounceHandle);
      debounceHandle = null;
    }
    mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
  };
}

function appendOption(selectEl: HTMLSelectElement, value: string, text: string): void {
  const option = selectEl.createEl('option', { text });
  option.value = value;
}

function formatDeviceLabel(raw: string): string {
  return raw.replace(VID_PID_SUFFIX, '').trim();
}
