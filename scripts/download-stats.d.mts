import type { Snapshot, SnapshotDelta } from './lib/download-stats-data.mjs';

export interface DownloadStatsArgs {
  help: boolean;
  json: boolean;
  snapshot: boolean;
}

export function parseArgs(argv: string[]): DownloadStatsArgs;

export interface TrafficReferrer {
  referrer: string;
  count: number;
  uniques: number;
}

export function buildReport(input: {
  current: Snapshot;
  delta: SnapshotDelta;
  referrers: TrafficReferrer[] | null;
}): string;
