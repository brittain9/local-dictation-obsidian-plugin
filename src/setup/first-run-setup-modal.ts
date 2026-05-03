import type { App } from 'obsidian';

import type { SidecarInstallManager } from '../sidecar/sidecar-install-manager';
import { getInstallCopy } from './sidecar-install-copy';
import { SidecarInstallModal } from './sidecar-install-modal';

export interface FirstRunSetupOptions {
  manager: SidecarInstallManager;
  onInstalled: () => Promise<void>;
  pluginDirectory: string;
  version: string;
}

export function openFirstRunSetupModal(app: App, options: FirstRunSetupOptions): void {
  new SidecarInstallModal(app, {
    copy: getInstallCopy('cpu', 'first-run'),
    manager: options.manager,
    onInstalled: options.onInstalled,
    pluginDirectory: options.pluginDirectory,
    variant: 'cpu',
    version: options.version,
  }).open();
}
