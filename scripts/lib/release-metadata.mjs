import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { compareCalverVersions, parseCalver } from './calver.mjs';

const CARGO_MANIFEST_VERSION_PATTERN = /(\[package\][\s\S]*?^version = ")([^"]+)("\r?$)/gm;
const CARGO_LOCK_VERSION_PATTERN =
  /(\[\[package\]\]\r?\nname = "local-dictation-sidecar"\r?\nversion = ")([^"]+)("\r?$)/gm;

export async function readReleaseMetadata(root = '.') {
  const rootDir = resolve(root);
  const paths = {
    cargoLock: join(rootDir, 'native', 'Cargo.lock'),
    cargoManifest: join(rootDir, 'native', 'Cargo.toml'),
    manifest: join(rootDir, 'manifest.json'),
    packageJson: join(rootDir, 'package.json'),
    packageLock: join(rootDir, 'package-lock.json'),
    sidecarVersion: join(rootDir, 'sidecar-version.json'),
    versions: join(rootDir, 'versions.json'),
  };
  const [manifest, packageJson, packageLock, sidecarVersion, cargoManifest, cargoLock, versions] =
    await Promise.all([
      readJson(paths.manifest),
      readJson(paths.packageJson),
      readJson(paths.packageLock),
      readJson(paths.sidecarVersion),
      readFile(paths.cargoManifest, 'utf8'),
      readFile(paths.cargoLock, 'utf8'),
      readJson(paths.versions),
    ]);

  return {
    cargoLock,
    cargoManifest,
    manifest,
    packageJson,
    packageLock,
    paths,
    sidecarVersion,
    versions,
  };
}

export function validateReleaseMetadata(metadata) {
  const version = requireString(metadata.manifest.version, 'manifest.json version');
  const minAppVersion = requireString(
    metadata.manifest.minAppVersion,
    'manifest.json minAppVersion',
  );
  parseCalver(version, 'manifest.json version');
  const sidecarVersion = requireString(
    metadata.sidecarVersion.version,
    'sidecar-version.json version',
  );
  parseCalver(sidecarVersion, 'sidecar-version.json version');

  const pluginMirrors = [
    ['package.json', metadata.packageJson.version],
    ['package-lock.json top-level', metadata.packageLock.version],
    ['package-lock.json packages[""]', metadata.packageLock.packages?.['']?.version],
  ];
  const pluginMismatches = pluginMirrors.filter(([, mirrorVersion]) => mirrorVersion !== version);
  if (pluginMismatches.length > 0) {
    throw new Error(
      `Plugin release versions must match manifest.json=${version}. Found mismatches: ${pluginMismatches
        .map(([label, mirrorVersion]) => `${label}=${String(mirrorVersion)}`)
        .join(', ')}.`,
    );
  }

  const sidecarMirrors = [
    [
      'native/Cargo.toml',
      readUniqueVersion(
        metadata.cargoManifest,
        CARGO_MANIFEST_VERSION_PATTERN,
        'native/Cargo.toml package version',
      ),
    ],
    [
      'native/Cargo.lock',
      readUniqueVersion(
        metadata.cargoLock,
        CARGO_LOCK_VERSION_PATTERN,
        'native/Cargo.lock local-dictation-sidecar version',
      ),
    ],
  ];
  const sidecarMismatches = sidecarMirrors.filter(
    ([, mirrorVersion]) => mirrorVersion !== sidecarVersion,
  );
  if (sidecarMismatches.length > 0) {
    throw new Error(
      `Sidecar versions must match sidecar-version.json=${sidecarVersion}. Found mismatches: ${sidecarMismatches
        .map(([label, mirrorVersion]) => `${label}=${String(mirrorVersion)}`)
        .join(', ')}.`,
    );
  }

  if (compareCalverVersions(sidecarVersion, version) > 0) {
    throw new Error(
      `sidecar-version.json version ${sidecarVersion} cannot be newer than plugin version ${version}.`,
    );
  }
  if (!Object.hasOwn(metadata.versions, sidecarVersion)) {
    throw new Error(
      `sidecar-version.json version ${sidecarVersion} must reference a release in versions.json.`,
    );
  }

  if (metadata.versions[version] !== minAppVersion) {
    throw new Error(
      `versions.json must map ${version} to manifest minAppVersion ${minAppVersion}; found ${String(metadata.versions[version])}.`,
    );
  }
  const newestVersion = Object.keys(metadata.versions).sort(compareCalverVersions).at(-1);
  if (newestVersion !== version) {
    throw new Error(
      `manifest.json version ${version} must be the newest versions.json entry; found ${String(newestVersion)}.`,
    );
  }

  return {
    includesSidecar: sidecarVersion === version,
    minAppVersion,
    sidecarVersion,
    version,
  };
}

export function buildReleaseMetadataWrites(metadata, options) {
  const manifest = structuredClone(metadata.manifest);
  const packageJson = structuredClone(metadata.packageJson);
  const packageLock = structuredClone(metadata.packageLock);
  const sidecarVersion = structuredClone(metadata.sidecarVersion);
  const versions = structuredClone(metadata.versions);

  if (packageLock.packages?.[''] === undefined) {
    throw new Error('package-lock.json is missing packages[""].');
  }
  if (Object.hasOwn(versions, options.version)) {
    throw new Error(`versions.json already contains ${options.version}.`);
  }

  manifest.version = options.version;
  manifest.minAppVersion = options.minAppVersion;
  packageJson.version = options.version;
  packageLock.version = options.version;
  packageLock.packages[''].version = options.version;
  versions[options.version] = options.minAppVersion;

  const writes = new Map([
    [metadata.paths.manifest, formatJson(manifest)],
    [metadata.paths.packageJson, formatJson(packageJson)],
    [metadata.paths.packageLock, formatJson(packageLock)],
    [metadata.paths.versions, formatJson(versions)],
  ]);

  if (options.includeSidecar) {
    sidecarVersion.version = options.version;
    writes.set(metadata.paths.sidecarVersion, formatJson(sidecarVersion));
    writes.set(
      metadata.paths.cargoManifest,
      replaceUniqueVersion(
        metadata.cargoManifest,
        CARGO_MANIFEST_VERSION_PATTERN,
        options.version,
        'native/Cargo.toml package version',
      ),
    );
    writes.set(
      metadata.paths.cargoLock,
      replaceUniqueVersion(
        metadata.cargoLock,
        CARGO_LOCK_VERSION_PATTERN,
        options.version,
        'native/Cargo.lock local-dictation-sidecar version',
      ),
    );
  }

  return writes;
}

function readUniqueVersion(contents, pattern, label) {
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label} must appear exactly once; found ${matches.length}.`);
  }
  return matches[0][2];
}

function replaceUniqueVersion(contents, pattern, version, label) {
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label} must appear exactly once; found ${matches.length}.`);
  }
  return contents.replace(pattern, `$1${version}$3`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
