import { Platform } from 'obsidian';

import { t, tPlural } from '../shared/i18n';
import type { SidecarInstallVariant } from '../sidecar/sidecar-installer';

export type InstallIntent = 'first-run' | 'install' | 'reinstall';

export interface InstallCopy {
  bodyText: string;
  primaryButtonText: string;
  successNotice: string;
  title: string;
}

const INSTALL_COPY_KEYS = {
  cpuFirstRun: {
    body: 'setup.sidecar.cpu.firstRun.body',
    primaryButton: 'setup.sidecar.cpu.firstRun.primaryButton',
    success: 'setup.sidecar.cpu.firstRun.success',
    title: 'setup.sidecar.cpu.firstRun.title',
  },
  cpuInstall: {
    body: 'setup.sidecar.cpu.install.body',
    primaryButton: 'setup.sidecar.cpu.install.primaryButton',
    success: 'setup.sidecar.cpu.install.success',
    title: 'setup.sidecar.cpu.install.title',
  },
  cpuReinstall: {
    body: 'setup.sidecar.cpu.reinstall.body',
    primaryButton: 'setup.sidecar.cpu.reinstall.primaryButton',
    success: 'setup.sidecar.cpu.reinstall.success',
    title: 'setup.sidecar.cpu.reinstall.title',
  },
  cudaInstall: {
    body: 'setup.sidecar.cuda.install.body',
    primaryButton: 'setup.sidecar.cuda.install.primaryButton',
    success: 'setup.sidecar.cuda.install.success',
    title: 'setup.sidecar.cuda.install.title',
  },
  macFirstRun: {
    body: 'setup.sidecar.mac.firstRun.body',
    primaryButton: 'setup.sidecar.mac.firstRun.primaryButton',
    success: 'setup.sidecar.mac.firstRun.success',
    title: 'setup.sidecar.mac.firstRun.title',
  },
  macInstall: {
    body: 'setup.sidecar.mac.install.body',
    primaryButton: 'setup.sidecar.mac.install.primaryButton',
    success: 'setup.sidecar.mac.install.success',
    title: 'setup.sidecar.mac.install.title',
  },
  macReinstall: {
    body: 'setup.sidecar.mac.reinstall.body',
    primaryButton: 'setup.sidecar.mac.reinstall.primaryButton',
    success: 'setup.sidecar.mac.reinstall.success',
    title: 'setup.sidecar.mac.reinstall.title',
  },
} as const;

function installCopy(
  keys: (typeof INSTALL_COPY_KEYS)[keyof typeof INSTALL_COPY_KEYS],
): InstallCopy {
  return {
    bodyText: t(keys.body),
    primaryButtonText: t(keys.primaryButton),
    successNotice: t(keys.success),
    title: t(keys.title),
  };
}

export function getInstallCopy(variant: SidecarInstallVariant, intent: InstallIntent): InstallCopy {
  if (variant === 'cuda') {
    return installCopy(INSTALL_COPY_KEYS.cudaInstall);
  }

  if (Platform.isMacOS) {
    if (intent === 'first-run') return installCopy(INSTALL_COPY_KEYS.macFirstRun);
    if (intent === 'reinstall') return installCopy(INSTALL_COPY_KEYS.macReinstall);
    return installCopy(INSTALL_COPY_KEYS.macInstall);
  }

  if (intent === 'first-run') return installCopy(INSTALL_COPY_KEYS.cpuFirstRun);
  if (intent === 'reinstall') return installCopy(INSTALL_COPY_KEYS.cpuReinstall);
  return installCopy(INSTALL_COPY_KEYS.cpuInstall);
}

export function getSidecarUpdateCopy(variants: readonly SidecarInstallVariant[]): InstallCopy {
  const hasCpu = variants.includes('cpu');
  const hasCuda = variants.includes('cuda');
  const engineLabel =
    hasCpu && hasCuda
      ? t('setup.sidecar.update.engine.cpuAndCuda')
      : hasCuda
        ? t('setup.sidecar.update.engine.cuda')
        : t('setup.sidecar.update.engine.default');
  const engineCount = Number(hasCpu) + Number(hasCuda);

  return {
    bodyText: t('setup.sidecar.update.body', { engineLabel }),
    primaryButtonText: tPlural(engineCount, {
      one: 'setup.sidecar.update.primaryButton_one',
      other: 'setup.sidecar.update.primaryButton_other',
    }),
    successNotice: tPlural(engineCount, {
      one: 'setup.sidecar.update.success_one',
      other: 'setup.sidecar.update.success_other',
    }),
    title: tPlural(engineCount, {
      one: 'setup.sidecar.update.title_one',
      other: 'setup.sidecar.update.title_other',
    }),
  };
}
