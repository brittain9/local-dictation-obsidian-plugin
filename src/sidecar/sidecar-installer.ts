import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { get as httpsGet, type RequestOptions } from 'node:https';
import { dirname, join, normalize, sep } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

import { getExistingPathKind } from '../filesystem/path-validation';
import { asError } from '../shared/error-utils';
import type { PluginLogger } from '../shared/plugin-logger';
import { formatSidecarExecutableName } from './sidecar-executable';

export type SidecarInstallVariant = 'cpu' | 'cuda';
export type InstallPhase = 'download' | 'verify' | 'extract';
export type TargetPlatform = 'darwin' | 'linux' | 'win32';
export type TargetArch = 'arm64' | 'x64';

export interface InstallManifest {
  version: string;
  variant: SidecarInstallVariant;
  sha256: string;
  installedAt: string;
}

export interface InstallProgress {
  bytesDownloaded: number;
  totalBytes: number | null;
  phase: InstallPhase;
}

export interface InstallSidecarOptions {
  beforeReplace?: (() => Promise<void>) | undefined;
  logger?: PluginLogger | undefined;
  onProgress?: ((progress: InstallProgress) => void) | undefined;
  pluginDirectory: string;
  releaseBaseUrl?: string | undefined;
  signal?: AbortSignal | undefined;
  variant: SidecarInstallVariant;
  version: string;
}

export interface InstallSidecarResult {
  manifest: InstallManifest;
  variantDirectory: string;
}

export const DEFAULT_RELEASE_BASE_URL =
  'https://github.com/brittain9/local-dictation-obsidian-plugin/releases/download';

const INSTALL_MANIFEST_FILENAME = 'install.json';

export function detectPlatformAsset(
  platform: TargetPlatform,
  arch: TargetArch,
  variant: SidecarInstallVariant,
): string {
  if (platform === 'darwin') {
    if (variant === 'cuda') {
      throw new Error('CUDA sidecar is not available on macOS.');
    }

    if (arch !== 'arm64') {
      throw new Error(
        'Local Dictation requires an Apple Silicon Mac (M1 or newer). Intel Macs are not supported.',
      );
    }

    return 'sidecar-macos-arm64.tar.gz';
  }

  if (arch !== 'x64') {
    throw new Error(`Unsupported ${platform} architecture for sidecar: ${arch}.`);
  }

  if (platform === 'linux') {
    return `sidecar-linux-x86_64-${variant}.tar.gz`;
  }

  return `sidecar-windows-x86_64-${variant}.tar.gz`;
}

export function detectPlatformAssetForCurrentEnv(variant: SidecarInstallVariant): string {
  return detectPlatformAsset(
    process.platform as TargetPlatform,
    process.arch as TargetArch,
    variant,
  );
}

export function variantDirectoryPath(
  pluginDirectory: string,
  variant: SidecarInstallVariant,
): string {
  return join(pluginDirectory, 'bin', variant);
}

export async function readInstallManifest(variantDir: string): Promise<InstallManifest | null> {
  let rawManifest: string;

  try {
    rawManifest = await readFile(join(variantDir, INSTALL_MANIFEST_FILENAME), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    return null;
  }

  if (!isInstallManifest(parsed)) return null;
  return parsed;
}

export async function uninstallSidecarVariant(
  pluginDirectory: string,
  variant: SidecarInstallVariant,
): Promise<void> {
  await rm(variantDirectoryPath(pluginDirectory, variant), { force: true, recursive: true });
}

export async function installSidecar(
  options: InstallSidecarOptions,
): Promise<InstallSidecarResult> {
  const assetName = detectPlatformAssetForCurrentEnv(options.variant);
  const releaseBaseUrl = (options.releaseBaseUrl ?? DEFAULT_RELEASE_BASE_URL).replace(/\/$/, '');
  const archiveUrl = `${releaseBaseUrl}/${options.version}/${assetName}`;
  const checksumsUrl = `${releaseBaseUrl}/${options.version}/checksums.txt`;

  const binDirectory = join(options.pluginDirectory, 'bin');
  const stagingDirectory = join(binDirectory, `.${options.variant}-staging`);
  const destinationDirectory = variantDirectoryPath(options.pluginDirectory, options.variant);

  await rm(stagingDirectory, { force: true, recursive: true });
  await mkdir(stagingDirectory, { recursive: true });

  try {
    const checksumsText = await fetchText(checksumsUrl, options.signal);
    const expectedSha256 = parseChecksum(checksumsText, assetName);

    const archivePath = join(stagingDirectory, assetName);
    const actualSha256 = await downloadToFile(
      archiveUrl,
      archivePath,
      (bytesDownloaded, totalBytes) => {
        options.onProgress?.({ bytesDownloaded, totalBytes, phase: 'download' });
      },
      options.signal,
    );

    options.onProgress?.({ bytesDownloaded: 0, totalBytes: null, phase: 'verify' });

    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `Checksum mismatch for ${assetName}: expected ${expectedSha256}, got ${actualSha256}.`,
      );
    }

    options.onProgress?.({ bytesDownloaded: 0, totalBytes: null, phase: 'extract' });
    await extractTarGz(archivePath, stagingDirectory);

    await rm(archivePath, { force: true });

    const executableName = resolveSidecarExecutableName();
    await markExecutable(join(stagingDirectory, executableName));

    const manifest: InstallManifest = {
      installedAt: new Date().toISOString(),
      sha256: actualSha256,
      variant: options.variant,
      version: options.version,
    };
    await writeFile(
      join(stagingDirectory, INSTALL_MANIFEST_FILENAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    await options.beforeReplace?.();

    // Atomic-ish promotion: move the existing install aside before we move
    // the new one in, so a crash between the two renames leaves a recoverable
    // backup rather than no install. Cleanup of any prior `.old` from a
    // previous crashed install happens up front so it cannot accumulate.
    const backupDir = `${destinationDirectory}.old`;
    const destExists = (await getExistingPathKind(destinationDirectory)) !== 'missing';

    if (destExists) {
      await rm(backupDir, { force: true, recursive: true });
      await rename(destinationDirectory, backupDir);
    }

    try {
      await rename(stagingDirectory, destinationDirectory);
    } catch (renameError) {
      if (destExists) {
        await rename(backupDir, destinationDirectory).catch((rollbackError) => {
          options.logger?.warn(
            'installer',
            `Failed to roll back install backup: ${asError(rollbackError, 'rollback').message}`,
          );
        });
      }
      throw renameError;
    }

    if (destExists) {
      await rm(backupDir, { force: true, recursive: true });
    }

    options.logger?.debug(
      'installer',
      `installed ${options.variant} sidecar ${options.version} at ${destinationDirectory}`,
    );

    return { manifest, variantDirectory: destinationDirectory };
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true }).catch(() => {
      /* ignore cleanup failure */
    });
    throw asError(error, `Failed to install ${options.variant} sidecar.`);
  }
}

export function parseChecksum(checksumsText: string, targetFilename: string): string {
  for (const line of checksumsText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const match = trimmed.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (match === null) continue;

    const [, hash, filename] = match;

    if (hash !== undefined && filename !== undefined && filename.trim() === targetFilename) {
      return hash.toLowerCase();
    }
  }

  throw new Error(`Checksum entry for ${targetFilename} not found in checksums.txt.`);
}

// GitHub Releases redirects from github.com URLs to objects.githubusercontent.com
// (signed URL with query params). One hop is all we ever need; refuse more so a
// misconfigured proxy or hijacked CDN can't bounce us through arbitrary URLs.
const MAX_REDIRECTS = 1;
const CHECKSUMS_SIZE_LIMIT = 1024 * 1024;

async function openHttpsStream(
  url: string,
  signal: AbortSignal | undefined,
  hops: number,
): Promise<IncomingMessage> {
  if (hops > MAX_REDIRECTS) {
    throw new Error(`Too many redirects fetching ${url}.`);
  }

  if (signal?.aborted) {
    throw abortError();
  }

  return new Promise((resolve, reject) => {
    const requestOptions: RequestOptions = { headers: { 'user-agent': 'local-dictation' } };
    const req = httpsGet(url, requestOptions, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;

      if (status >= 300 && status < 400 && typeof location === 'string' && location.length > 0) {
        res.resume();
        const nextUrl = new URL(location, url).toString();
        openHttpsStream(nextUrl, signal, hops + 1).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${String(status)} fetching ${url}.`));
        return;
      }

      resolve(res);
    });

    req.on('error', reject);

    if (signal) {
      const onAbort = (): void => {
        req.destroy(abortError());
      };

      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
        req.once('close', () => {
          signal.removeEventListener('abort', onAbort);
        });
      }
    }
  });
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const stream = await openHttpsStream(url, signal, 0);
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    size += buffer.length;

    if (size > CHECKSUMS_SIZE_LIMIT) {
      stream.destroy();
      throw new Error(`Response body for ${url} exceeded ${CHECKSUMS_SIZE_LIMIT} bytes.`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

const PROGRESS_REPORT_BYTE_DELTA = 256 * 1024;
const PROGRESS_REPORT_INTERVAL_MS = 100;
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

async function downloadToFile(
  url: string,
  destPath: string,
  onProgress: (bytesDownloaded: number, totalBytes: number | null) => void,
  signal?: AbortSignal,
): Promise<string> {
  const stream = await openHttpsStream(url, signal, 0);
  const contentLengthHeader = stream.headers['content-length'];
  const totalBytes =
    typeof contentLengthHeader === 'string' && /^\d+$/.test(contentLengthHeader)
      ? Number.parseInt(contentLengthHeader, 10)
      : null;

  const fileStream = createWriteStream(destPath);
  const hash: Hash = createHash('sha256');
  let writeError: Error | null = null;
  let bytesDownloaded = 0;
  let lastReportedBytes = 0;
  let lastReportedAt = 0;

  let idleTimer: NodeJS.Timeout | null = null;
  const armIdleTimer = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stream.destroy(
        new Error(
          `Download stalled: no data received from ${url} for ${String(DOWNLOAD_IDLE_TIMEOUT_MS)}ms.`,
        ),
      );
    }, DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  const clearIdleTimer = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const throwIfWriteFailed = (): void => {
    if (writeError !== null) throw writeError;
  };
  const onWriteError = (error: Error): void => {
    writeError ??= error;
    stream.destroy(error);
  };
  fileStream.on('error', onWriteError);

  armIdleTimer();

  try {
    for await (const chunk of stream) {
      armIdleTimer();
      throwIfWriteFailed();
      const buffer = chunk as Buffer;
      bytesDownloaded += buffer.length;
      hash.update(buffer);

      const now = Date.now();
      if (
        bytesDownloaded - lastReportedBytes >= PROGRESS_REPORT_BYTE_DELTA ||
        now - lastReportedAt >= PROGRESS_REPORT_INTERVAL_MS
      ) {
        onProgress(bytesDownloaded, totalBytes);
        lastReportedBytes = bytesDownloaded;
        lastReportedAt = now;
      }

      if (!fileStream.write(buffer)) {
        await waitForFileStreamEvent(fileStream, 'drain');
      }
      throwIfWriteFailed();
    }
    if (bytesDownloaded !== lastReportedBytes) {
      onProgress(bytesDownloaded, totalBytes);
    }
  } finally {
    clearIdleTimer();
    try {
      await finishFileStream(fileStream);
    } finally {
      fileStream.off('error', onWriteError);
    }
  }
  throwIfWriteFailed();

  return hash.digest('hex');
}

async function markExecutable(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  await chmod(path, 0o755);
}

async function finishFileStream(fileStream: WriteStream): Promise<void> {
  if (fileStream.destroyed) return;
  const finished = waitForFileStreamEvent(fileStream, 'finish');
  fileStream.end();
  await finished;
}

function waitForFileStreamEvent(
  fileStream: WriteStream,
  eventName: 'drain' | 'finish',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      fileStream.off(eventName, onEvent);
      fileStream.off('error', onError);
    };
    const onEvent = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    fileStream.once(eventName, onEvent);
    fileStream.once('error', onError);
  });
}

function resolveSidecarExecutableName(): string {
  return formatSidecarExecutableName(process.platform === 'win32');
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  // Stream the gunzip so the event loop is not blocked while decompressing
  // (matters for the CUDA bundle). Memory is still O(archive) but no longer
  // O(archive) of synchronous CPU on the main thread.
  const chunks: Buffer[] = [];
  await pipeline(
    createReadStream(archivePath),
    createGunzip(),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  const decompressed = Buffer.concat(chunks);
  const blockSize = 512;
  let offset = 0;

  while (offset + blockSize <= decompressed.length) {
    const header = decompressed.subarray(offset, offset + blockSize);
    offset += blockSize;

    if (isZeroBlock(header)) continue;

    const name = readCString(header, 0, 100);
    const prefix = readCString(header, 345, 155);
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const sizeOctal = readCString(header, 124, 12).trim();
    const size = sizeOctal.length > 0 ? Number.parseInt(sizeOctal, 8) : 0;

    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Invalid tar entry size for ${name}.`);
    }

    const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;
    const isRegularFile = typeflag === '0' || typeflag === '\0';
    const isDirectory = typeflag === '5';
    const dataEnd = offset + size;

    if (dataEnd > decompressed.length) {
      throw new Error(`Tar entry ${fullName} is truncated.`);
    }

    if (!isRegularFile && !isDirectory) {
      // Symlink ('2'), hardlink ('1'), PAX/GNU extended headers ('x'/'g'/'L'),
      // character/block devices, etc. We do not ship any of these in release
      // archives. Fail loudly instead of silently dropping data so a producer
      // change cannot quietly break installs.
      throw new Error(
        `Unsupported tar entry type '${typeflag}' for ${fullName}. Release archives must contain only regular files and directories.`,
      );
    }

    const resolvedPath = resolveArchiveMemberPath(fullName, destDir);

    if (isDirectory) {
      await mkdir(resolvedPath, { recursive: true });
    } else {
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, decompressed.subarray(offset, dataEnd));
    }

    offset += Math.ceil(size / blockSize) * blockSize;
  }
}

function resolveArchiveMemberPath(memberName: string, destDir: string): string {
  const cleaned = memberName.replace(/\\/g, '/');

  if (cleaned.length === 0) {
    throw new Error('Refusing empty archive entry name.');
  }

  if (cleaned.startsWith('/') || /^[a-z]:/i.test(cleaned)) {
    throw new Error(`Refusing archive entry with absolute path: ${memberName}`);
  }

  const resolved = normalize(join(destDir, cleaned));
  const normalizedDest = normalize(destDir);
  const boundary = normalizedDest.endsWith(sep) ? normalizedDest : `${normalizedDest}${sep}`;

  if (resolved !== normalizedDest && !resolved.startsWith(boundary)) {
    throw new Error(`Refusing archive entry outside destination: ${memberName}`);
  }

  return resolved;
}

function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) {
    if (byte !== 0) return false;
  }
  return true;
}

function readCString(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const terminator = slice.indexOf(0);
  const end = terminator === -1 ? slice.length : terminator;
  return slice.subarray(0, end).toString('utf8');
}

function isInstallManifest(value: unknown): value is InstallManifest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.version === 'string' &&
    (record.variant === 'cpu' || record.variant === 'cuda') &&
    typeof record.sha256 === 'string' &&
    typeof record.installedAt === 'string'
  );
}
