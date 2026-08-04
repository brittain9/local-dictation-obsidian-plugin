import { formatBytes } from '../shared/format-utils';
import { t } from '../shared/i18n';
import type { ModelInstallState, ModelInstallUpdateRecord } from './model-management-types';

export interface InstallProgressState
  extends Pick<
    ModelInstallUpdateRecord,
    'details' | 'downloadedBytes' | 'message' | 'state' | 'totalBytes'
  > {
  isCancelling: boolean;
}

interface InstallProgressViewModel {
  bytesLabel: string | null;
  hasFailed: boolean;
  isCancelling: boolean;
  primaryLine: string;
  progressPercent: number | null;
  secondaryLine: string | null;
}

export function buildInstallProgressViewModel(
  state: InstallProgressState,
): InstallProgressViewModel {
  const downloadedBytes =
    state.downloadedBytes !== null && state.totalBytes !== null
      ? Math.min(state.downloadedBytes, state.totalBytes)
      : state.downloadedBytes;
  const bytesLabel =
    downloadedBytes !== null && state.totalBytes !== null
      ? `${formatBytes(downloadedBytes)} / ${formatBytes(state.totalBytes)}`
      : downloadedBytes !== null
        ? formatBytes(downloadedBytes)
        : state.totalBytes !== null
          ? formatBytes(state.totalBytes)
          : null;
  const progressPercent =
    downloadedBytes !== null && state.totalBytes !== null && state.totalBytes > 0
      ? Math.max(0, Math.min(100, (downloadedBytes / state.totalBytes) * 100))
      : null;

  return {
    bytesLabel,
    hasFailed: state.state === 'failed',
    isCancelling: state.isCancelling,
    primaryLine: resolvePrimaryLine(state.message, state.state),
    progressPercent,
    // A failure spends its second line on the reason. Progress phases spend it
    // on "File 2 of 5"; neither has anything useful to say in the other's state.
    secondaryLine:
      state.state === 'failed'
        ? normalizeOptionalLine(state.message)
        : state.state === 'downloading' || state.state === 'verifying'
          ? localizeDetails(state.details)
          : null,
  };
}

export function createInstallProgressElement(state: InstallProgressState): HTMLDivElement {
  const root = createDiv();
  const header = createDiv();
  const statusLine = createSpan();

  root.className = 'local-stt-install-progress';
  header.className = 'local-stt-install-progress__header';
  statusLine.className = 'local-stt-install-progress__status';
  header.append(statusLine);
  root.append(header);

  const progressTrack = createDiv();
  const progressFill = createDiv();

  progressTrack.className = 'local-stt-install-progress__track';
  progressTrack.setAttribute('role', 'progressbar');
  progressTrack.setAttribute('aria-valuemin', '0');
  progressTrack.setAttribute('aria-valuemax', '100');
  progressFill.className = 'local-stt-install-progress__fill';
  progressTrack.append(progressFill);
  root.append(progressTrack);

  renderInstallProgress(root, buildInstallProgressViewModel(state));

  return root;
}

export function updateInstallProgressElement(
  root: HTMLDivElement,
  state: InstallProgressState,
): void {
  const viewModel = buildInstallProgressViewModel(state);

  renderInstallProgress(root, viewModel);
}

function renderInstallProgress(root: HTMLDivElement, viewModel: InstallProgressViewModel): void {
  root.classList.toggle('local-stt-install-progress--cancelling', viewModel.isCancelling);
  root.classList.toggle('local-stt-install-progress--failed', viewModel.hasFailed);

  const status = root.querySelector<HTMLElement>('.local-stt-install-progress__status');
  if (status) status.textContent = viewModel.primaryLine;

  const header = root.querySelector<HTMLElement>('.local-stt-install-progress__header');
  if (header) reconcileBytesLabel(header, viewModel.bytesLabel);

  const fill = root.querySelector<HTMLDivElement>('.local-stt-install-progress__fill');
  if (fill) fill.style.width = `${viewModel.progressPercent ?? 0}%`;

  const track = root.querySelector<HTMLElement>('.local-stt-install-progress__track');
  if (track) {
    track.setAttribute('aria-label', viewModel.primaryLine);
    if (viewModel.progressPercent === null) {
      track.removeAttribute('aria-valuenow');
    } else {
      track.setAttribute('aria-valuenow', String(Math.round(viewModel.progressPercent)));
    }
  }

  reconcileSecondaryLine(root, viewModel.secondaryLine);
}

function reconcileBytesLabel(header: HTMLElement, bytesLabel: string | null): void {
  const existing = header.querySelector<HTMLElement>('.local-stt-install-progress__bytes');

  if (bytesLabel === null) {
    existing?.remove();
    return;
  }

  if (existing !== null) {
    existing.textContent = bytesLabel;
    return;
  }

  const bytes = createSpan();
  bytes.className = 'local-stt-install-progress__bytes';
  bytes.textContent = bytesLabel;
  header.append(bytes);
}

function reconcileSecondaryLine(root: HTMLDivElement, secondaryLine: string | null): void {
  const existing = root.querySelector<HTMLElement>('.local-stt-install-progress__details');

  if (secondaryLine === null) {
    existing?.remove();
    return;
  }

  if (existing !== null) {
    existing.textContent = secondaryLine;
    return;
  }

  const details = createDiv();
  details.className = 'local-stt-install-progress__details';
  details.textContent = secondaryLine;
  root.append(details);
}

function normalizeOptionalLine(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function cleanMessageLine(line: string): string {
  const match = line.match(/^(Downloading|Verifying)\s+(.+)$/);
  if (match === null) return line;
  const verb = match[1] as string;
  const filename = match[2] as string;
  const lastSlash = filename.lastIndexOf('/');
  const basename = lastSlash === -1 ? filename : filename.slice(lastSlash + 1);
  return verb === 'Downloading'
    ? t('models.progress.downloadingFile', { filename: basename })
    : t('models.progress.verifyingFile', { filename: basename });
}

function resolvePrimaryLine(message: string | null, state: ModelInstallState): string {
  const normalizedMessage = normalizeOptionalLine(message);
  if (normalizedMessage !== null && (state === 'downloading' || state === 'verifying')) {
    return cleanMessageLine(normalizedMessage);
  }

  switch (state) {
    case 'queued':
      return t('models.progress.preparing');
    case 'downloading':
      return t('models.progress.downloading');
    case 'verifying':
      return t('models.progress.verifying');
    case 'probing':
      return t('models.progress.validating');
    case 'completed':
      return t('models.progress.installed');
    case 'cancelled':
      return t('models.progress.cancelled');
    case 'failed':
      return t('models.progress.failed');
  }
}

function localizeDetails(details: string | null): string | null {
  const normalized = normalizeOptionalLine(details);
  if (normalized === null) return null;

  const fileCount = normalized.match(/^File (\d+) of (\d+)$/u);
  if (fileCount === null) return normalized;

  return t('models.progress.fileCount', {
    current: fileCount[1] ?? '',
    total: fileCount[2] ?? '',
  });
}
