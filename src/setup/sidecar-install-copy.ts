import { Platform } from 'obsidian';

import type { SidecarInstallVariant } from '../sidecar/sidecar-installer';

export type InstallIntent = 'first-run' | 'install' | 'reinstall';

export interface InstallCopy {
  bodyText: string;
  primaryButtonText: string;
  successNotice: string;
  title: string;
}

const MAC_FIRST_RUN: InstallCopy = {
  bodyText:
    'Local Dictation needs a one-time download of its speech-to-text engine from GitHub releases. Once installed, transcription runs entirely on your Mac — audio never leaves your machine.',
  primaryButtonText: 'Download sidecar',
  successNotice: 'Local Dictation sidecar installed and started.',
  title: 'Finish setting up Local Dictation',
};

const MAC_INSTALL: InstallCopy = {
  bodyText:
    'Download the speech-to-text engine from GitHub releases. Transcription runs locally on your Mac after this completes.',
  primaryButtonText: 'Download sidecar',
  successNotice: 'Sidecar installed and started.',
  title: 'Install sidecar',
};

const MAC_REINSTALL: InstallCopy = {
  bodyText:
    'Re-download the speech-to-text engine from GitHub releases. This replaces the current install.',
  primaryButtonText: 'Redownload sidecar',
  successNotice: 'Sidecar reinstalled and restarted.',
  title: 'Reinstall sidecar',
};

const CPU_FIRST_RUN: InstallCopy = {
  bodyText:
    'Local Dictation needs a one-time download of the CPU speech-to-text engine from GitHub releases. Transcription runs locally on your machine after this completes. You can install CUDA acceleration later from settings.',
  primaryButtonText: 'Download CPU sidecar',
  successNotice: 'Local Dictation sidecar installed and started.',
  title: 'Finish setting up Local Dictation',
};

const CPU_INSTALL: InstallCopy = {
  bodyText:
    'Download the CPU speech-to-text engine from GitHub releases. Transcription runs locally on your machine after this completes.',
  primaryButtonText: 'Download CPU sidecar',
  successNotice: 'CPU sidecar installed and started.',
  title: 'Install CPU sidecar',
};

const CPU_REINSTALL: InstallCopy = {
  bodyText:
    'Re-download the CPU speech-to-text engine from GitHub releases. This replaces the current CPU install.',
  primaryButtonText: 'Redownload CPU sidecar',
  successNotice: 'CPU sidecar reinstalled and restarted.',
  title: 'Reinstall CPU sidecar',
};

const CUDA_INSTALL: InstallCopy = {
  bodyText:
    'Download the CUDA-accelerated sidecar for NVIDIA GPUs. This replaces the CPU sidecar while active. The CPU sidecar remains installed as a fallback.',
  primaryButtonText: 'Download CUDA sidecar',
  successNotice: 'CUDA sidecar installed and started.',
  title: 'Install CUDA acceleration',
};

export function getInstallCopy(variant: SidecarInstallVariant, intent: InstallIntent): InstallCopy {
  if (variant === 'cuda') {
    return CUDA_INSTALL;
  }

  if (Platform.isMacOS) {
    if (intent === 'first-run') return MAC_FIRST_RUN;
    if (intent === 'reinstall') return MAC_REINSTALL;
    return MAC_INSTALL;
  }

  if (intent === 'first-run') return CPU_FIRST_RUN;
  if (intent === 'reinstall') return CPU_REINSTALL;
  return CPU_INSTALL;
}
