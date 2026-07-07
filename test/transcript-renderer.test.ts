import { describe, expect, it } from 'vitest';

import { DEFAULT_SMART_PARAGRAPH_PAUSE_MS } from '../src/settings/plugin-settings';
import { buildSpeakerSpans, formatLandmark, TranscriptRenderer } from '../src/transcript/renderer';
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
      pauseMsBeforeUtterance: DEFAULT_SMART_PARAGRAPH_PAUSE_MS,
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
          pauseMsBeforeUtterance: DEFAULT_SMART_PARAGRAPH_PAUSE_MS - 1,
          text: 'short',
        },
        't',
      ).projectedText,
    ).toBe(' short');
    expect(
      planAndCommit(renderer, {
        pauseMsBeforeUtterance: DEFAULT_SMART_PARAGRAPH_PAUSE_MS,
        text: 'long',
      }).projectedText,
    ).toBe('\n\nlong');
  });

  it('uses custom smart paragraph line and paragraph thresholds', () => {
    const renderer = new TranscriptRenderer({
      smartParagraphPauses: { lineBreakPauseMs: 1000, paragraphPauseMs: 3000 },
      timestamps: timestamps(),
      transcriptFormatting: 'smart',
    });

    expect(planAndCommit(renderer, { text: 'first' }).projectedText).toBe('first');
    expect(
      planAndCommit(
        renderer,
        {
          pauseMsBeforeUtterance: 999,
          text: 'short',
        },
        't',
      ).projectedText,
    ).toBe(' short');
    expect(
      planAndCommit(
        renderer,
        {
          pauseMsBeforeUtterance: 1000,
          text: 'line',
        },
        't',
      ).projectedText,
    ).toBe('\nline');
    expect(
      planAndCommit(renderer, {
        pauseMsBeforeUtterance: 3000,
        text: 'paragraph',
      }).projectedText,
    ).toBe('\n\nparagraph');
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
      timestamps: timestamps({ clock: 'wallclock', enabled: true, header: false }),
      transcriptFormatting: 'space',
    });

    const first = planAndCommit(renderer, { text: 'first', utteranceStartMsInSession: 60_000 });

    expect(first.projectedText).toBe('(14:33) first');
  });
});

describe('TranscriptRenderer speaker labels', () => {
  it('labels the first assigned utterance, suppresses same-speaker repeats, and relabels on change', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps(),
      transcriptFormatting: 'space',
    });

    expect(planAndCommit(renderer, { speakerIndex: 0, text: 'hi' }).projectedText).toBe(
      '**Speaker 1:** hi',
    );
    expect(planAndCommit(renderer, { speakerIndex: 0, text: 'still me' }, 't').projectedText).toBe(
      ' still me',
    );
    expect(planAndCommit(renderer, { speakerIndex: 1, text: 'now you' }, 't').projectedText).toBe(
      ' **Speaker 2:** now you',
    );
    expect(planAndCommit(renderer, { speakerIndex: 0, text: 'me again' }, 't').projectedText).toBe(
      ' **Speaker 1:** me again',
    );
  });

  it('never labels when the speaker is unassigned (diarization off)', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps(),
      transcriptFormatting: 'space',
    });

    expect(planAndCommit(renderer, { speakerIndex: null, text: 'first' }).projectedText).toBe(
      'first',
    );
    expect(planAndCommit(renderer, { speakerIndex: null, text: 'second' }, 't').projectedText).toBe(
      ' second',
    );
  });

  it('never labels invalid speaker indexes', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps(),
      transcriptFormatting: 'space',
    });

    expect(planAndCommit(renderer, { speakerIndex: Number.NaN, text: 'nan' }).projectedText).toBe(
      'nan',
    );
    const missingSpeaker = { text: 'missing' };
    expect(planAndCommit(renderer, missingSpeaker, 't').projectedText).toBe(' missing');
  });

  it('keeps same-speaker suppression across an unassigned utterance', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps(),
      transcriptFormatting: 'space',
    });

    planAndCommit(renderer, { speakerIndex: 0, text: 'one' });
    // A null utterance carries no speaker, so it must not reset the running
    // speaker and trigger a spurious relabel on the next same-speaker line.
    planAndCommit(renderer, { speakerIndex: null, text: 'gap' }, 't');
    expect(planAndCommit(renderer, { speakerIndex: 0, text: 'two' }, 't').projectedText).toBe(
      ' two',
    );
  });

  it('does not advance the running speaker until the append is committed', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps(),
      transcriptFormatting: 'space',
    });

    // Planning twice without committing must re-emit the same first-speaker label;
    // only commitAppend advances the suppression state.
    const planned = renderer.planAppend(
      {
        pauseMsBeforeUtterance: null,
        spans: [{ speakerIndex: 0, text: 'a' }],
        utteranceId: 'u',
        utteranceStartMsInSession: 0,
      },
      { tailContent: '' },
    );
    const replanned = renderer.planAppend(
      {
        pauseMsBeforeUtterance: null,
        spans: [{ speakerIndex: 0, text: 'a' }],
        utteranceId: 'u',
        utteranceStartMsInSession: 0,
      },
      { tailContent: '' },
    );

    expect(planned.projectedText).toBe('**Speaker 1:** a');
    expect(replanned.projectedText).toBe('**Speaker 1:** a');
  });

  it('composes the speaker label after the timestamp on one line', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps({ enabled: true, header: false }),
      transcriptFormatting: 'space',
    });

    const first = planAndCommit(renderer, {
      speakerIndex: 0,
      text: 'hello',
      utteranceStartMsInSession: 0,
    });
    const later = planAndCommit(
      renderer,
      { speakerIndex: 1, text: 'reply', utteranceStartMsInSession: DEFAULT_SPARSE_INTERVAL_MS },
      't',
    );

    expect(first.projectedText).toBe('(0:00) **Speaker 1:** hello');
    expect(later.projectedText).toBe(' (0:30) **Speaker 2:** reply');
  });

  it('excludes the speaker label from the replaceable text region', () => {
    const renderer = new TranscriptRenderer({
      timestamps: timestamps(),
      transcriptFormatting: 'space',
    });

    const projection = planAndCommit(renderer, { speakerIndex: 0, text: 'hello' });

    // The label rides in the prefix so an interim->final text swap (which only
    // rewrites [textStartOffset, textEndOffset]) leaves the label intact.
    expect(projection.insertedText).toBe('hello');
    expect(projection.projectedText.slice(projection.textStartOffset)).toBe('hello');
    expect(projection.projectedText.slice(0, projection.textStartOffset)).toBe('**Speaker 1:** ');
  });
});

interface PlanAndCommitInput {
  pauseMsBeforeUtterance?: number | null;
  speakerIndex?: number | null;
  text: string;
  utteranceId?: string;
  utteranceStartMsInSession?: number;
}

describe('TranscriptRenderer multi-speaker utterances', () => {
  const labelOptions = () => ({ timestamps: timestamps(), transcriptFormatting: 'space' as const });

  it('renders each speaker turn on its own labelled line', () => {
    const renderer = new TranscriptRenderer(labelOptions());

    const projection = renderer.planAppend(
      {
        pauseMsBeforeUtterance: null,
        spans: [
          { speakerIndex: 0, text: 'hello there' },
          { speakerIndex: 1, text: 'hi back' },
          { speakerIndex: 0, text: 'how are you' },
        ],
        utteranceId: 'u',
        utteranceStartMsInSession: 0,
      },
      { tailContent: '' },
    );

    expect(projection.projectedText).toBe(
      '**Speaker 1:** hello there\n**Speaker 2:** hi back\n**Speaker 1:** how are you',
    );
    expect(projection.insertedText).toBe(projection.projectedText);
    expect(projection.emittedSpeakerIndex).toBe(0);
  });

  it('suppresses the leading label when the first turn continues the previous speaker', () => {
    const renderer = new TranscriptRenderer(labelOptions());

    renderer.commitAppend(
      renderer.planAppend(
        {
          pauseMsBeforeUtterance: null,
          spans: [{ speakerIndex: 0, text: 'one' }],
          utteranceId: 'a',
          utteranceStartMsInSession: 0,
        },
        { tailContent: '' },
      ),
    );

    const next = renderer.planAppend(
      {
        pauseMsBeforeUtterance: null,
        spans: [
          { speakerIndex: 0, text: 'still me' },
          { speakerIndex: 1, text: 'now you' },
        ],
        utteranceId: 'b',
        utteranceStartMsInSession: 0,
      },
      { tailContent: 'one' },
    );

    expect(next.projectedText).toBe(' still me\n**Speaker 2:** now you');
    expect(next.precedingSpeakerIndex).toBe(0);
  });

  it('recomposes a replacement body with the captured preceding speaker', () => {
    const renderer = new TranscriptRenderer(labelOptions());
    const spans = [
      { speakerIndex: 0, text: 'a' },
      { speakerIndex: 1, text: 'b' },
    ];

    expect(renderer.composeReplacementBody(spans, null)).toBe('**Speaker 1:** a\n**Speaker 2:** b');
    // When the previous line was already speaker 0, the first label is suppressed.
    expect(renderer.composeReplacementBody(spans, 0)).toBe('a\n**Speaker 2:** b');
  });
});

describe('buildSpeakerSpans', () => {
  const segment = (speaker: number | null, text: string) => ({
    endMs: 0,
    speaker,
    startMs: 0,
    text,
    timestampGranularity: 'segment' as const,
    timestampSource: 'engine' as const,
  });

  it('collapses to one span carrying the fallback text when single-speaker', () => {
    // Lets LLM-cleaned text flow through for single-speaker utterances.
    expect(buildSpeakerSpans([segment(0, 'a'), segment(0, 'b')], 'cleaned a b', 0)).toEqual([
      { speakerIndex: 0, text: 'cleaned a b' },
    ]);
  });

  it('groups consecutive same-speaker segments when multi-speaker', () => {
    expect(
      buildSpeakerSpans(
        [segment(0, 'hello'), segment(0, 'there'), segment(1, 'hi'), segment(0, 'bye')],
        'ignored joined text',
        0,
      ),
    ).toEqual([
      { speakerIndex: 0, text: 'hello there' },
      { speakerIndex: 1, text: 'hi' },
      { speakerIndex: 0, text: 'bye' },
    ]);
  });

  it('uses the fallback span when diarization is off', () => {
    expect(buildSpeakerSpans([segment(null, 'a')], 'a', null)).toEqual([
      { speakerIndex: null, text: 'a' },
    ]);
  });
});

function planAndCommit(renderer: TranscriptRenderer, input: PlanAndCommitInput, tailContent = '') {
  const projection = renderer.planAppend(
    {
      pauseMsBeforeUtterance: input.pauseMsBeforeUtterance ?? null,
      spans: [{ speakerIndex: input.speakerIndex ?? null, text: input.text }],
      utteranceId: input.utteranceId ?? 'utt',
      utteranceStartMsInSession: input.utteranceStartMsInSession ?? 0,
    },
    { tailContent },
  );
  renderer.commitAppend(projection);

  return projection;
}
