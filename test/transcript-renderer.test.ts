import { describe, expect, it } from 'vitest';

import {
  formatLandmark,
  formatSpeakerLabel,
  SMART_PARAGRAPH_PAUSE_MS,
  type TranscriptAppendInput,
  TranscriptRenderer,
} from '../src/transcript/renderer';
import {
  DEFAULT_SESSION_START_MS,
  DEFAULT_SPARSE_INTERVAL_MS,
  timestamps,
} from './helpers/render-options';

describe('formatLandmark', () => {
  it.each([
    [0, '(0:00)'],
    [999, '(0:00)'],
    [65_999, '(1:05)'],
    [3_599_999, '(59:59)'],
    [3_600_000, '(1:00:00)'],
    [3_723_000, '(1:02:03)'],
  ])('formats %i ms as %s', (elapsedMs, expected) => {
    expect(formatLandmark(elapsedMs, DEFAULT_SESSION_START_MS, 'elapsed')).toBe(expected);
  });

  it('formats wall-clock landmarks without seconds', () => {
    expect(formatLandmark(65_000, DEFAULT_SESSION_START_MS, 'wallclock')).toBe('(14:33)');
  });
});

describe('formatSpeakerLabel', () => {
  it.each([
    ['SPEAKER_00', 'Speaker 1'],
    ['speaker-02', 'Speaker 3'],
    ['  Alice:  ', 'Alice'],
    ['Ava\nChen', 'Ava Chen'],
  ])('formats %s as %s', (raw, expected) => {
    expect(formatSpeakerLabel(raw)).toBe(expected);
  });

  it('drops empty speaker labels', () => {
    expect(formatSpeakerLabel('   ')).toBeNull();
  });
});

describe('TranscriptRenderer', () => {
  it('renders the first timestamp and then suppresses short-interval timestamps', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: false }),
      transcriptFormatting: 'space',
    });

    const first = planAndCommit(renderer, { text: 'first', utteranceStartMsInSession: 0 });
    const second = planAndCommit(
      renderer,
      {
        pauseMsBeforeUtterance: 250,
        text: 'second',
        utteranceStartMsInSession: 10_000,
      },
      't',
    );

    expect(first.projectedText).toBe('(0:00) first');
    expect(second.projectedText).toBe(' second');
  });

  it('emits a timestamp at the next utterance boundary after the sparse interval', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: false }),
      transcriptFormatting: 'space',
    });

    planAndCommit(renderer, { text: 'first', utteranceStartMsInSession: 0 });
    const second = planAndCommit(
      renderer,
      {
        pauseMsBeforeUtterance: 250,
        text: 'later',
        utteranceStartMsInSession: DEFAULT_SPARSE_INTERVAL_MS,
      },
      't',
    );

    expect(second.projectedText).toBe(' (0:30) later');
  });

  it('emits one timestamp when a long pause and sparse interval co-occur', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: false }),
      transcriptFormatting: 'new_paragraph',
    });

    planAndCommit(renderer, { text: 'first', utteranceStartMsInSession: 0 });
    const second = planAndCommit(renderer, {
      pauseMsBeforeUtterance: SMART_PARAGRAPH_PAUSE_MS,
      text: 'later',
      utteranceStartMsInSession: DEFAULT_SPARSE_INTERVAL_MS,
    });

    expect(second.projectedText).toBe('\n\n(0:30) later');
    expect(second.projectedText.match(/\(0:30\)/gu)).toHaveLength(1);
  });

  it.each([
    ['space', ' second'],
    ['new_line', '\nsecond'],
    ['new_paragraph', '\n\nsecond'],
  ] as const)('renders %s formatting as a prefix', (transcriptFormatting, expectedSecond) => {
    const renderer = new TranscriptRenderer({ timestamps: timestamps(), transcriptFormatting });

    expect(planAndCommit(renderer, { text: 'first' }).projectedText).toBe('first');
    expect(planAndCommit(renderer, { text: 'second' }, 't').projectedText).toBe(expectedSecond);
  });

  it('normalizes existing whitespace and newline tails', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps(),
      transcriptFormatting: 'new_paragraph',
    });

    planAndCommit(renderer, { text: 'first' });

    expect(planAndCommit(renderer, { text: 'second' }, '\n').projectedText).toBe('\nsecond');
    expect(planAndCommit(renderer, { text: 'third' }, '\n\n').projectedText).toBe('third');
  });

  it('uses the meaningful pause threshold for smart paragraphs', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps(),
      transcriptFormatting: 'smart',
    });

    expect(planAndCommit(renderer, { text: 'first' }).projectedText).toBe('first');
    expect(
      planAndCommit(
        renderer,
        {
          pauseMsBeforeUtterance: SMART_PARAGRAPH_PAUSE_MS - 1,
          text: 'short',
        },
        't',
      ).projectedText,
    ).toBe(' short');
    expect(
      planAndCommit(renderer, {
        pauseMsBeforeUtterance: SMART_PARAGRAPH_PAUSE_MS,
        text: 'long',
      }).projectedText,
    ).toBe('\n\nlong');
  });

  it('treats null pause as continuation while still allowing interval timestamps', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: false }),
      transcriptFormatting: 'smart',
    });

    planAndCommit(renderer, { text: 'first', utteranceStartMsInSession: 0 });
    const split = planAndCommit(
      renderer,
      {
        pauseMsBeforeUtterance: null,
        text: 'split',
        utteranceStartMsInSession: 30_000,
      },
      't',
    );

    expect(split.projectedText).toBe(' (0:30) split');
  });

  it('renders the session header once before the first landmark', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: true }),
      transcriptFormatting: 'space',
    });

    const first = planAndCommit(renderer, { text: 'first', utteranceStartMsInSession: 0 });
    const second = planAndCommit(
      renderer,
      { text: 'second', utteranceStartMsInSession: 30_000 },
      't',
    );

    expect(first.projectedText).toBe('[2026-05-16 14:32]\n(0:00) first');
    expect(first.replacementPrefix).toBe('');
    expect(second.projectedText).toBe(' (0:30) second');
  });

  it('emits a landmark for every utterance when density is every utterance', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ density: 'every_utterance', enabled: true, header: false }),
      transcriptFormatting: 'space',
    });

    planAndCommit(renderer, { text: 'first', utteranceStartMsInSession: 0 });
    const second = planAndCommit(
      renderer,
      {
        text: 'second',
        utteranceStartMsInSession: 1_000,
      },
      't',
    );

    expect(second.projectedText).toBe(' (0:01) second');
  });

  it('uses the configured sparse interval', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({
        enabled: true,
        header: false,
        sparseIntervalMs: 10_000,
      }),
      transcriptFormatting: 'space',
    });

    planAndCommit(renderer, { text: 'first', utteranceStartMsInSession: 0 });
    expect(
      planAndCommit(renderer, { text: 'soon', utteranceStartMsInSession: 9_999 }, 't')
        .projectedText,
    ).toBe(' soon');
    expect(
      planAndCommit(renderer, { text: 'threshold', utteranceStartMsInSession: 10_000 }, 't')
        .projectedText,
    ).toBe(' (0:10) threshold');
  });

  it('uses wall-clock inline landmarks', () => {
    const renderer = new TranscriptRenderer({
      speakerLabelsEnabled: false,
      timestamps: timestamps({ clock: 'wallclock', enabled: true, header: false }),
      transcriptFormatting: 'space',
    });

    const first = planAndCommit(renderer, { text: 'first', utteranceStartMsInSession: 60_000 });

    expect(first.projectedText).toBe('(14:33) first');
  });

  it('prefixes text with a speaker label when speaker labels are enabled', () => {
    const renderer = new TranscriptRenderer({
      speakerLabelsEnabled: true,
      timestamps: timestamps({ enabled: true, header: false }),
      transcriptFormatting: 'space',
    });

    const first = planAndCommit(renderer, {
      speaker: 'SPEAKER_00',
      text: 'hello there',
      utteranceStartMsInSession: 0,
    });

    expect(first.projectedText).toBe('(0:00) Speaker 1: hello there');
    expect(first.insertedText).toBe('hello there');
    expect(first.textStartOffset).toBe('(0:00) Speaker 1: '.length);
  });

  it('ignores speaker metadata when speaker labels are disabled', () => {
    const renderer = new TranscriptRenderer({
      speakerLabelsEnabled: false,
      timestamps: timestamps(),
      transcriptFormatting: 'space',
    });

    expect(planAndCommit(renderer, { speaker: 'SPEAKER_00', text: 'hello' }).projectedText).toBe(
      'hello',
    );
  });
});

function planAndCommit(
  renderer: TranscriptRenderer,
  input: Partial<TranscriptAppendInput> & { text: string },
  tailContent = '',
) {
  const projection = renderer.planAppend(
    {
      pauseMsBeforeUtterance: null,
      utteranceId: 'utt',
      utteranceStartMsInSession: 0,
      ...input,
    },
    { tailContent },
  );
  renderer.commitAppend(projection);

  return projection;
}
