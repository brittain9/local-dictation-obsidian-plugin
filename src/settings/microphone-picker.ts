import { type DropdownComponent, Setting } from 'obsidian';

import { formatMicrophoneCaptureErrorMessage } from '../audio/microphone-permission-message';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type { UserFeedback } from '../shared/user-feedback';
import type { AudioInputDevice } from './plugin-settings';
import type { SettingAccess } from './setting-helpers';

const DEFAULT_OPTION_VALUE = '__default__';
const MISSING_OPTION_VALUE = '__missing__';
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
  feedback: Pick<UserFeedback, 'show'>;
  isDictationBusy: () => boolean;
  logger?: PluginLogger | undefined;
}

export function renderMicrophonePicker(
  parent: HTMLElement,
  deps: MicrophonePickerDependencies,
): () => void {
  const hostWindow = parent.win;
  const mediaDevices = hostWindow.navigator?.mediaDevices;
  const setting = new Setting(parent)
    .setName(t('settings.microphone.name'))
    .setDesc(t('settings.microphone.desc'));

  let devices: MediaDeviceInfo[] = [];
  let microphoneDropdown: DropdownComponent | null = null;
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
    if (microphoneDropdown === null) {
      return;
    }

    const saved = getSaved();
    const { selectEl } = microphoneDropdown;
    selectEl.empty();

    microphoneDropdown.addOption(DEFAULT_OPTION_VALUE, t('settings.microphone.default'));

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
            : t('settings.microphone.labelUnavailable');
      microphoneDropdown.addOption(device.deviceId, display);
    }

    let selectedValue = DEFAULT_OPTION_VALUE;
    if (saved !== null && !savedIsPresent) {
      microphoneDropdown.addOption(
        MISSING_OPTION_VALUE,
        t('settings.microphone.notConnected', { microphone: saved.label }),
      );
      selectedValue = MISSING_OPTION_VALUE;
    } else if (saved !== null) {
      selectedValue = saved.deviceId;
    }
    // Obsidian 1.13 measures the selected option through DropdownComponent and
    // stores its fitted width in CSS. Updating selectEl.value directly skips
    // that initial measurement, leaving the control as wide as its longest
    // option until the user changes it once.
    microphoneDropdown.setValue(selectedValue);

    refreshDetectButton();
  }

  function refreshDetectButton(): void {
    if (detectButtonEl === null) {
      return;
    }
    if (mediaDevices?.getUserMedia === undefined) {
      detectButtonEl.hide();
      return;
    }
    // Show the button whenever no enumerated device has a usable label. That
    // covers the empty list (locked-down OS permission, no inputs visible) and
    // the labels-look-empty cases (permission not yet granted, or label is
    // only a VID:PID suffix that formatDeviceLabel strips to '').
    const hasLabeledDevice = devices.some((device) => formatDeviceLabel(device.label).length > 0);
    detectButtonEl.toggle(!hasLabeledDevice);
  }

  async function enumerate(): Promise<void> {
    const version = ++enumerateVersion;
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
    microphoneDropdown = dropdown;
    dropdown.onChange((value) => {
      void handleChange(value);
    });
  });

  setting.addExtraButton((button) => {
    button
      .setIcon('refresh-cw')
      .setTooltip(t('settings.microphone.detectTooltip'))
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
      deps.feedback.show({
        intent: 'action-required',
        key: 'microphone-permission',
        message: t('settings.microphone.allowAccessFirst'),
      });
      const saved = getSaved();
      microphoneDropdown?.setValue(saved?.deviceId ?? DEFAULT_OPTION_VALUE);
      return;
    }

    await deps.access.persistOne('audioInputDevice', { deviceId: picked.deviceId, label });
    repopulate();
  }

  async function primePermission(): Promise<void> {
    if (deps.isDictationBusy()) {
      deps.feedback.show({
        intent: 'warning',
        message: t('settings.microphone.stopDictationToDetect'),
      });
      return;
    }

    if (mediaDevices?.getUserMedia === undefined) {
      deps.feedback.show({
        intent: 'error',
        message: t('settings.microphone.unavailableRuntime'),
      });
      return;
    }

    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      await enumerate();
    } catch (error) {
      deps.feedback.show({
        cause: error,
        intent: 'action-required',
        key: 'microphone-permission',
        message:
          formatMicrophoneCaptureErrorMessage(error) ?? t('settings.microphone.detectFailed'),
      });
    }
  }

  let debounceHandle: number | null = null;
  const onDeviceChange = (): void => {
    if (debounceHandle !== null) {
      hostWindow.clearTimeout(debounceHandle);
    }
    debounceHandle = hostWindow.setTimeout(() => {
      debounceHandle = null;
      void enumerate();
    }, DEVICE_CHANGE_DEBOUNCE_MS);
  };

  mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

  void enumerate();

  return () => {
    disposed = true;
    if (debounceHandle !== null) {
      hostWindow.clearTimeout(debounceHandle);
      debounceHandle = null;
    }
    mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
  };
}

function formatDeviceLabel(raw: string): string {
  return raw.replace(VID_PID_SUFFIX, '').trim();
}
