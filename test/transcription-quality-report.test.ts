import { describe, expect, it } from 'vitest';

import {
  buildQualityReport,
  parseQualityMeasurements,
  renderQualityReportMarkdown,
} from '../scripts/lib/transcription-quality-report.mjs';

function measurement(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    suite: 'multilingual-product-path',
    modelId: 'model',
    modelName: 'Model',
    language: 'es',
    selection: 'manual',
    fixtureId: 'fixture',
    qualityMetric: 'wer',
    qualityErrorRate: 0.1,
    qualityBudget: 0.45,
    audioDurationMs: 2_000,
    processingDurationMs: 500,
    realTimeFactor: 0.25,
    realTimeFactorBudget: 1,
    passed: true,
    ...overrides,
  };
}

describe('transcription quality report', () => {
  it('aggregates processing-weighted RTF and renders release-readable definitions', () => {
    const report = buildQualityReport([
      measurement(),
      measurement({
        audioDurationMs: 1_000,
        fixtureId: 'fixture-2',
        processingDurationMs: 500,
        qualityErrorRate: 0.2,
      }),
    ]);

    expect(report.rows[0]).toMatchObject({
      fixtureCount: 2,
      maxErrorRate: 0.2,
      maxRealTimeFactorBudget: 1,
      realTimeFactor: 1 / 3,
    });
    expect(report.rows[0]?.meanErrorRate).toBeCloseTo(0.15);
    const markdown = renderQualityReportMarkdown(report);
    expect(markdown).toContain('15.0% / 20.0% WER');
    expect(markdown).toContain('0.33× / ≤ 1.00×');
    expect(markdown).toContain('RTF is model processing time divided by fixture audio duration');
    expect(markdown).toContain('not a substitute for native-speaker release review');
    expect(markdown).toContain('hosted-CPU timing budget is a portable regression ceiling');
  });

  it('rejects malformed and duplicate measurements instead of hiding bad evidence', () => {
    expect(() => parseQualityMeasurements('{"schemaVersion":1}\n')).toThrow('missing suite');
    expect(() =>
      parseQualityMeasurements(
        `${JSON.stringify(measurement({ realTimeFactor: 0.5 }))}\n`,
        'invalid.jsonl',
      ),
    ).toThrow('realTimeFactor does not match measured durations');
    expect(() =>
      parseQualityMeasurements(
        `${JSON.stringify(measurement({ qualityErrorRate: 0.6 }))}\n`,
        'invalid.jsonl',
      ),
    ).toThrow('passed measurement exceeds an acceptance budget');
    expect(() => buildQualityReport([measurement(), measurement()])).toThrow(
      'duplicate measurement',
    );
  });
});
