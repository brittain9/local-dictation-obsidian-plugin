import { describe, expect, it } from 'vitest';

import {
  createBuildSteps,
  createInstallStep,
  type DevCudaInstallOptions,
  type InstallSnapshot,
  parseArgs,
  summarizeInstallChanges,
} from '../scripts/install-dev-cuda.mjs';

function options(overrides: Partial<DevCudaInstallOptions> = {}): DevCudaInstallOptions {
  return {
    cleanCuda: false,
    cuda: true,
    enable: true,
    help: false,
    jobs: null,
    release: false,
    resetData: false,
    vault: '/vault',
    ...overrides,
  };
}

function file(sha256: string, size = 1): { kind: 'file'; sha256: string; size: number } {
  return { kind: 'file', sha256, size };
}

describe('parseArgs', () => {
  it('accepts the vault as a flag and parses install options', () => {
    expect(
      parseArgs([
        '--vault',
        '/tmp/vault',
        '--release',
        '--jobs',
        '8',
        '--clean-cuda',
        '--no-enable',
        '--reset-data',
      ]),
    ).toMatchObject({
      cleanCuda: true,
      enable: false,
      jobs: 8,
      release: true,
      resetData: true,
      vault: '/tmp/vault',
    });
  });

  it('accepts a positional vault path for the one-command workflow', () => {
    expect(parseArgs(['/tmp/vault']).vault).toBe('/tmp/vault');
  });

  it('rejects invalid job counts', () => {
    expect(() => parseArgs(['--vault', '/tmp/vault', '--jobs', '0'])).toThrow(/positive integer/);
  });
});

describe('createBuildSteps', () => {
  it('builds frontend, CPU sidecar, CUDA sidecar, and verification on Linux', () => {
    const steps = createBuildSteps(options(), 'linux');

    expect(steps.map((step) => step.label)).toEqual([
      'Build frontend bundle',
      'Build CPU sidecar',
      'Build CUDA sidecar',
      'Verify build output',
    ]);
    expect(steps[2]?.command).toBe('bash');
    expect(steps[2]?.args).toEqual(['scripts/build-cuda.sh']);
    expect(steps[2]?.retry?.args).toEqual(['scripts/build-cuda.sh', '--clean']);
  });

  it('passes release, clean, and job options to the relevant build steps', () => {
    const steps = createBuildSteps(options({ cleanCuda: true, jobs: 4, release: true }), 'linux');

    expect(steps[1]?.args).toContain('--release');
    expect(steps[2]?.args).toEqual([
      'scripts/build-cuda.sh',
      '--release',
      '--clean',
      '--jobs',
      '4',
    ]);
    expect(steps[2]?.retry).toBeUndefined();
    expect(steps[3]?.args).toContain('--release');
  });

  it('can intentionally skip CUDA for CPU-only dev installs', () => {
    const steps = createBuildSteps(options({ cuda: false }), 'linux');

    expect(steps.map((step) => step.label)).toEqual([
      'Build frontend bundle',
      'Build CPU sidecar',
      'Verify build output',
    ]);
  });

  it('rejects unsupported CUDA platforms unless CUDA is skipped', () => {
    expect(() => createBuildSteps(options(), 'darwin')).toThrow(/Use --skip-cuda/);
  });
});

describe('createInstallStep', () => {
  it('installs sidecars and enables the plugin by default', () => {
    const step = createInstallStep(options());

    expect(step.args).toEqual([
      'scripts/install-dev-plugin.mjs',
      '--vault',
      '/vault',
      '--sidecars',
      '--enable',
    ]);
  });

  it('passes release and omits enable when requested', () => {
    const step = createInstallStep(options({ enable: false, release: true }));

    expect(step.args).toEqual([
      'scripts/install-dev-plugin.mjs',
      '--vault',
      '/vault',
      '--sidecars',
      '--release',
    ]);
  });
});

describe('summarizeInstallChanges', () => {
  it('classifies overwritten, created, removed, and preserved install files', () => {
    const before: InstallSnapshot = new Map([
      ['bin/old-runtime.so', file('old-runtime')],
      ['data.json', file('settings')],
      ['main.js', file('old-main', 10)],
      ['styles.css', file('same-style')],
    ]);
    const after: InstallSnapshot = new Map([
      ['data.json', file('settings')],
      ['main.js', file('new-main', 20)],
      ['manifest.json', file('manifest')],
      ['styles.css', file('same-style')],
    ]);

    expect(summarizeInstallChanges(before, after)).toEqual({
      created: ['manifest.json'],
      overwrittenChanged: ['main.js'],
      overwrittenUnchanged: ['styles.css'],
      preserved: ['data.json'],
      removed: ['bin/old-runtime.so'],
    });
  });
});
