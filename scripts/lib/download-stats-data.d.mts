export interface SidecarAssetClassification {
  os: string;
  arch: string;
  accel: 'cpu' | 'cuda' | null;
}

export function classifySidecarAsset(name: string): SidecarAssetClassification | null;
export function platformSplitKey(classification: SidecarAssetClassification): string;

export interface AssetDownloadCounts {
  assets: Record<string, number>;
}

export interface ReleaseSummary extends AssetDownloadCounts {
  tag: string;
  publishedAt: string;
}

export function aggregatePlatformSplit(
  releases: readonly AssetDownloadCounts[],
): Record<string, number>;
export function sumMainJsDownloads(releases: readonly AssetDownloadCounts[]): number;

export interface RepoMeta {
  stars: number;
  forks: number;
  watchers: number;
}

export interface ObsidianRegistrySummary {
  total: number;
  byVersion: Record<string, number>;
}

export interface TrafficWindow {
  count: number;
  uniques: number;
}

export interface TrafficSummary {
  views: TrafficWindow;
  clones: TrafficWindow;
}

export interface Snapshot {
  schemaVersion: 1;
  capturedAt: string;
  repo: RepoMeta;
  releaseAssets: {
    mainJsTotal: number;
    byRelease: ReleaseSummary[];
  };
  platformSplit: Record<string, number>;
  obsidianRegistry: ObsidianRegistrySummary;
  traffic: TrafficSummary | null;
}

export function normalizeSnapshot(input: {
  capturedAt: string;
  repo: RepoMeta;
  releases: readonly ReleaseSummary[];
  obsidianRegistry: ObsidianRegistrySummary;
  traffic: TrafficSummary | null;
}): Snapshot;

export interface SnapshotDelta {
  hasPrevious: boolean;
  daysSincePrevious: number | null;
  mainJsDownloadsGained: number | null;
  registryDownloadsGained: number | null;
}

export function computeDelta(previous: Snapshot | null, current: Snapshot): SnapshotDelta;
