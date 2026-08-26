#!/usr/bin/env node
// One-command local dev deployment:
//   build frontend + CPU sidecar + CUDA sidecar, verify the output, then install
//   a fresh copy into a target Obsidian vault. The wrapper prunes stale files
//   from the installed plugin directory immediately before reinstalling, while
//   preserving vault-local plugin settings by default.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, readlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const PLUGIN_ID = 'local-dictation';
const PRESERVED_PLUGIN_FILES = Object.freeze(['data.json']);

const HELP_TEXT = `Usage: npm run install:dev:cuda -- --vault <vault-path> [OPTIONS]

Builds frontend, CPU sidecar, CUDA sidecar, verifies outputs, then force-installs
the dev plugin into <vault-path>/.obsidian/plugins/${PLUGIN_ID}.

Options:
  --vault <path>   Obsidian vault path. A single positional path is also accepted.
  --release        Build and install release-profile sidecars.
  --jobs N         CUDA build job count.
  --clean-cuda     Clean native/target-cuda before rebuilding CUDA.
  --skip-cuda      Build/install CPU sidecar only.
  --no-enable      Do not enable the plugin in the target vault.
  --reset-data     Also delete existing plugin data.json before reinstalling.
  --help, -h       Show this help text.
`;

export function parseArgs(argv) {
  const options = {
    cleanCuda: false,
    cuda: true,
    enable: true,
    help: false,
    jobs: null,
    release: false,
    resetData: false,
    vault: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--release') {
      options.release = true;
    } else if (arg === '--clean-cuda') {
      options.cleanCuda = true;
    } else if (arg === '--skip-cuda' || arg === '--no-cuda') {
      options.cuda = false;
    } else if (arg === '--no-enable') {
      options.enable = false;
    } else if (arg === '--reset-data') {
      options.resetData = true;
    } else if (arg === '--vault') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--vault requires a path.');
      }
      options.vault = value;
      index += 1;
    } else if (arg.startsWith('--vault=')) {
      const value = arg.slice('--vault='.length);
      if (value.length === 0) {
        throw new Error('--vault requires a path.');
      }
      options.vault = value;
    } else if (arg === '--jobs') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--jobs requires a value.');
      }
      options.jobs = parsePositiveInteger(value, '--jobs');
      index += 1;
    } else if (arg.startsWith('--jobs=')) {
      options.jobs = parsePositiveInteger(arg.slice('--jobs='.length), '--jobs');
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (options.vault === null) {
      options.vault = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  return options;
}

export function createBuildSteps(options, platform = process.platform) {
  const profileArgs = options.release ? ['--release'] : [];
  const steps = [
    {
      args: ['run', 'build:frontend'],
      command: npmCommand(platform),
      label: 'Build frontend bundle',
    },
    {
      args: ['scripts/build-sidecar.mjs', ...profileArgs],
      command: nodeCommand(),
      label: 'Build CPU sidecar',
    },
  ];

  if (options.cuda) {
    steps.push(createCudaBuildStep(options, platform));
  }

  steps.push({
    args: ['scripts/verify-build-output.mjs', ...profileArgs],
    command: nodeCommand(),
    label: 'Verify build output',
  });

  return steps;
}

export function createInstallStep(options) {
  const args = [
    'scripts/install-dev-plugin.mjs',
    '--vault',
    options.vault,
    '--sidecars',
    ...(options.release ? ['--release'] : []),
    ...(options.enable ? ['--enable'] : []),
  ];

  return {
    args,
    command: nodeCommand(),
    label: 'Install into vault',
  };
}

export function summarizeInstallChanges(before, after, preservedFiles = PRESERVED_PLUGIN_FILES) {
  const preserved = [];
  const overwrittenChanged = [];
  const overwrittenUnchanged = [];
  const created = [];
  const removed = [];
  const preservedSet = new Set(preservedFiles);
  const paths = new Set([...before.keys(), ...after.keys()]);

  for (const path of [...paths].sort()) {
    const beforeEntry = before.get(path);
    const afterEntry = after.get(path);

    if (preservedSet.has(path) && beforeEntry !== undefined && afterEntry !== undefined) {
      preserved.push(path);
      continue;
    }

    if (beforeEntry !== undefined && afterEntry !== undefined) {
      if (entryFingerprint(beforeEntry) === entryFingerprint(afterEntry)) {
        overwrittenUnchanged.push(path);
      } else {
        overwrittenChanged.push(path);
      }
    } else if (beforeEntry === undefined && afterEntry !== undefined) {
      created.push(path);
    } else if (beforeEntry !== undefined && afterEntry === undefined) {
      removed.push(path);
    }
  }

  return { created, overwrittenChanged, overwrittenUnchanged, preserved, removed };
}

async function main(rawArgs) {
  const options = parseArgs(rawArgs);
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (options.vault === null) {
    console.log(HELP_TEXT);
    throw new Error('Missing required --vault path.');
  }

  options.vault = resolve(options.vault);
  await requireVaultDirectory(options.vault);

  const pluginDirectory = join(options.vault, '.obsidian', 'plugins', PLUGIN_ID);
  const buildSteps = createBuildSteps(options);
  const installStep = createInstallStep(options);

  printHeader(options, pluginDirectory);

  let stepIndex = 1;
  const totalSteps = buildSteps.length + 3;
  await runDependencyStep(stepIndex, totalSteps);
  stepIndex += 1;

  for (const step of buildSteps) {
    runStep(stepIndex, totalSteps, step);
    stepIndex += 1;
  }

  const before = await snapshotPluginDirectory(pluginDirectory);
  await runPrepareStep(stepIndex, totalSteps, pluginDirectory, options);
  stepIndex += 1;

  runStep(stepIndex, totalSteps, installStep);

  const after = await snapshotPluginDirectory(pluginDirectory);
  printChangeReport(summarizeInstallChanges(before, after), pluginDirectory);
}

async function requireVaultDirectory(vaultPath) {
  let info;
  try {
    info = await lstat(vaultPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Vault path does not exist: ${vaultPath}`);
    }
    throw error;
  }

  if (!info.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${vaultPath}`);
  }
}

async function runDependencyStep(stepIndex, totalSteps) {
  console.log(`\n[${stepIndex}/${totalSteps}] Check npm dependencies`);
  if (await fileExists(join('node_modules', 'esbuild', 'package.json'))) {
    console.log('  ok: node_modules is present');
    return;
  }

  const step = {
    args: ['install'],
    command: npmCommand(),
    label: 'Install npm dependencies',
  };
  console.log(`  running: ${formatCommand(step.command, step.args)}`);
  runCommand(step.command, step.args);
}

function runStep(stepIndex, totalSteps, step) {
  console.log(`\n[${stepIndex}/${totalSteps}] ${step.label}`);
  console.log(`  running: ${formatCommand(step.command, step.args)}`);
  try {
    runCommand(step.command, step.args, step.env);
  } catch (error) {
    if (step.retry === undefined) throw error;
    console.warn(`  ${step.retry.reason}`);
    console.warn(`  retrying: ${formatCommand(step.retry.command, step.retry.args)}`);
    runCommand(step.retry.command, step.retry.args, step.retry.env);
  }
}

async function runPrepareStep(stepIndex, totalSteps, pluginDirectory, options) {
  console.log(`\n[${stepIndex}/${totalSteps}] Prepare target plugin directory`);
  const preserved = await prunePluginDirectory(pluginDirectory, {
    preserveData: !options.resetData,
  });

  if (preserved.length === 0) {
    console.log('  pruned existing plugin directory; no plugin data was preserved');
    return;
  }

  console.log(`  pruned existing plugin directory; preserved ${preserved.join(', ')}`);
}

async function prunePluginDirectory(pluginDirectory, options) {
  const preserved = [];
  let info;

  try {
    info = await lstat(pluginDirectory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(pluginDirectory, { recursive: true });
    return preserved;
  }

  if (!info.isDirectory() || info.isSymbolicLink()) {
    await rm(pluginDirectory, { force: true, recursive: true });
    await mkdir(pluginDirectory, { recursive: true });
    return preserved;
  }

  const entries = await readdir(pluginDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (options.preserveData && PRESERVED_PLUGIN_FILES.includes(entry.name)) {
      preserved.push(entry.name);
      continue;
    }
    await rm(join(pluginDirectory, entry.name), { force: true, recursive: true });
  }

  return preserved;
}

async function snapshotPluginDirectory(pluginDirectory) {
  const entries = new Map();
  let info;

  try {
    info = await lstat(pluginDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return entries;
    throw error;
  }

  if (info.isSymbolicLink()) {
    entries.set('.', {
      kind: 'symlink',
      linkTarget: await readlink(pluginDirectory),
      size: 0,
    });
    return entries;
  }

  if (!info.isDirectory()) {
    entries.set('.', await fileSnapshot(pluginDirectory, info));
    return entries;
  }

  await walkDirectory(pluginDirectory, '', entries);
  return entries;
}

async function walkDirectory(directory, prefix, entries) {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  for (const entry of directoryEntries) {
    const path = join(directory, entry.name);
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const info = await lstat(path);

    if (info.isSymbolicLink()) {
      entries.set(relativePath, {
        kind: 'symlink',
        linkTarget: await readlink(path),
        size: 0,
      });
    } else if (info.isDirectory()) {
      await walkDirectory(path, relativePath, entries);
    } else if (info.isFile()) {
      entries.set(relativePath, await fileSnapshot(path, info));
    }
  }
}

async function fileSnapshot(path, info) {
  const data = await readFile(path);
  return {
    kind: 'file',
    sha256: createHash('sha256').update(data).digest('hex'),
    size: info.size,
  };
}

function printHeader(options, pluginDirectory) {
  console.log('Speech Kit dev CUDA install');
  console.log(`  vault:    ${options.vault}`);
  console.log(`  plugin:   ${pluginDirectory}`);
  console.log(`  profile:  ${options.release ? 'release' : 'debug'}`);
  console.log(`  cuda:     ${options.cuda ? 'enabled' : 'skipped'}`);
  console.log(`  enable:   ${options.enable ? 'yes' : 'no'}`);
  console.log(
    `  preserve: ${options.resetData ? 'nothing (--reset-data)' : PRESERVED_PLUGIN_FILES.join(', ')}`,
  );
}

function printChangeReport(summary, pluginDirectory) {
  console.log('\nOverride report');
  console.log(`  target: ${pluginDirectory}`);
  printList('  overwritten (changed)', summary.overwrittenChanged);
  printList('  overwritten (same content)', summary.overwrittenUnchanged);
  printList('  created', summary.created);
  printList('  removed stale', summary.removed);
  printList('  preserved', summary.preserved);
  console.log('\nDone.');
}

function printList(label, values) {
  const max = 40;
  if (values.length === 0) {
    console.log(`${label}: none`);
    return;
  }

  console.log(`${label}:`);
  for (const value of values.slice(0, max)) {
    console.log(`    ${value}`);
  }
  if (values.length > max) {
    console.log(`    ... ${values.length - max} more`);
  }
}

function createCudaBuildStep(options, platform) {
  if (platform === 'linux') {
    const args = [
      'scripts/build-cuda.sh',
      ...(options.release ? ['--release'] : []),
      ...(options.cleanCuda ? ['--clean'] : []),
      ...(options.jobs === null ? [] : ['--jobs', String(options.jobs)]),
    ];
    const retryArgs = [
      'scripts/build-cuda.sh',
      ...(options.release ? ['--release'] : []),
      '--clean',
      ...(options.jobs === null ? [] : ['--jobs', String(options.jobs)]),
    ];

    return {
      args,
      command: 'bash',
      label: 'Build CUDA sidecar',
      retry: options.cleanCuda
        ? undefined
        : {
            args: retryArgs,
            command: 'bash',
            reason:
              'CUDA build failed; retrying once with --clean to clear stale native build state.',
          },
    };
  }

  if (platform === 'win32') {
    if (options.cleanCuda) {
      throw new Error('--clean-cuda is only supported by scripts/build-cuda.sh on Linux.');
    }

    return {
      args: [
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'scripts/build-cuda.ps1',
        ...(options.release ? ['-Release'] : []),
      ],
      command: 'powershell',
      env: options.jobs === null ? undefined : { BUILD_JOBS: String(options.jobs) },
      label: 'Build CUDA sidecar',
    };
  }

  throw new Error(`CUDA sidecar builds are not supported on ${platform}. Use --skip-cuda.`);
}

function runCommand(command, args, extraEnv) {
  const result = spawnSync(command, args, {
    env: extraEnv === undefined ? process.env : { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${formatCommand(command, args)} failed with exit code ${result.status}.`);
  }
}

async function fileExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function parsePositiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function entryFingerprint(entry) {
  if (entry.kind === 'file') return `${entry.kind}:${entry.size}:${entry.sha256}`;
  return `${entry.kind}:${entry.linkTarget}`;
}

function npmCommand(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function nodeCommand() {
  return process.execPath;
}

function formatCommand(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '');

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\nerror: ${error.message}`);
    process.exitCode = 1;
  });
}
