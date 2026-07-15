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
  passed: boolean;
}

export interface QualityReportRow {
  fixtureCount: number;
  maxErrorRate: number;
  meanErrorRate: number;
  realTimeFactor: number;
  maxRealTimeFactorBudget: number;
}

export interface QualityReport {
  rows: QualityReportRow[];
  summary: {
    failedMeasurements: number;
    languages: string[];
    measurementCount: number;
    models: string[];
  };
}

export function parseQualityMeasurements(text: string, source?: string): QualityMeasurement[];
export function buildQualityReport(
  measurements: QualityMeasurement[],
  metadata?: { commitSha?: string; generatedAt?: string; runner?: string },
): QualityReport;
export function renderQualityReportMarkdown(report: QualityReport): string;
