export interface QualityMeasurement {
  schemaVersion: number;
  suite: string;
  modelId: string;
  modelName: string;
  language: string;
  selection: string;
  fixtureId: string;
  qualityMetric: string;
  qualityErrorRate: number;
  qualityBudget: number;
  audioDurationMs: number;
  processingDurationMs: number;
  realTimeFactor: number;
  realTimeFactorBudget: number;
  firstPartialAudioMs?: number;
  firstPartialAudioBudgetMs?: number;
  utteranceCount?: number;
  partialCount?: number;
  passed: boolean;
}

export interface QualityReportRow {
  audioDurationMs: number;
  firstPartialAudioMs: number | null;
  firstPartialAudioBudgetMs: number | null;
  fixtureCount: number;
  language: string;
  maxErrorRate: number;
  maxQualityBudget: number;
  maxRealTimeFactorBudget: number;
  meanErrorRate: number;
  modelId: string;
  modelName: string;
  passed: boolean;
  processingDurationMs: number;
  qualityMetric: string;
  realTimeFactor: number;
  selection: string;
  suite: string;
}

export interface QualityReport {
  schemaVersion: number;
  generatedAt: string | null;
  commitSha: string | null;
  runner: string | null;
  summary: {
    audioDurationMs: number;
    failedMeasurements: number;
    languages: string[];
    measurementCount: number;
    models: string[];
    passedMeasurements: number;
  };
  rows: QualityReportRow[];
  measurements: QualityMeasurement[];
}

export function parseQualityMeasurements(text: string, source?: string): QualityMeasurement[];
export function buildQualityReport(
  measurements: QualityMeasurement[],
  metadata?: {
    commitSha?: string | null;
    generatedAt?: string | null;
    runner?: string | null;
  },
): QualityReport;
export function renderQualityReportMarkdown(report: QualityReport): string;
