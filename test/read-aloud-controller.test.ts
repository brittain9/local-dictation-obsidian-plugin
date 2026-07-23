import type { Editor, EditorPosition } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogRecord } from '../src/models/model-management-types';
import { DEFAULT_PLUGIN_SETTINGS } from '../src/settings/plugin-settings';
import type { StartSynthesisCommand } from '../src/sidecar/protocol';

const playback = vi.hoisted(() => ({
  enqueue: vi.fn(),
  markGenerationComplete: vi.fn(),
  playThrough: vi.fn<(sequence: number) => void>(),
  start: vi.fn(),
  stop: vi.fn(),
  togglePaused: vi.fn(async () => false),
}));

vi.mock('../src/audio/pcm-playback-queue', () => ({
  PcmPlaybackQueue: class {
    constructor(options: { onPlayedThrough: (sequence: number) => void }) {
      playback.playThrough.mockImplementation(options.onPlayedThrough);
    }

    enqueue = playback.enqueue;
    markGenerationComplete = playback.markGenerationComplete;
    start = playback.start;
    stop = playback.stop;
    togglePaused = playback.togglePaused;
  },
}));

import { ReadAloudController, resolveReadRange } from '../src/tts/read-aloud-controller';

function editorFor(source: string, cursor: EditorPosition, selection?: [number, number]): Editor {
  const lines = source.split('\n');
  const offset = (position: EditorPosition): number => {
    let result = 0;
    for (let line = 0; line < position.line; line += 1) result += (lines[line]?.length ?? 0) + 1;
    return result + position.ch;
  };
  const position = (value: number): EditorPosition => {
    let remaining = value;
    for (let line = 0; line < lines.length; line += 1) {
      const length = lines[line]?.length ?? 0;
      if (remaining <= length) return { ch: remaining, line };
      remaining -= length + 1;
    }
    return { ch: 0, line: lines.length - 1 };
  };
  return {
    getValue: () => source,
    getCursor: (side?: string) => {
      if (selection === undefined) return cursor;
      return side === 'anchor' ? position(selection[0]) : position(selection[1]);
    },
    getLine: (line: number) => lines[line] ?? '',
    posToOffset: offset,
    somethingSelected: () => selection !== undefined,
  } as unknown as Editor;
}

const TTS_SELECTION = {
  familyId: 'pocket_tts',
  kind: 'catalog_model',
  modelId: 'pocket_tts_english_2026_04_int8',
  runtimeId: 'onnx_runtime',
} as const;

const TTS_CATALOG = {
  catalogVersion: 1,
  collections: [],
  families: [],
  models: [
    {
      defaultVoice: 'alba',
      familyId: TTS_SELECTION.familyId,
      modelId: TTS_SELECTION.modelId,
      runtimeId: TTS_SELECTION.runtimeId,
    },
  ],
} as unknown as ModelCatalogRecord;

type StartSynthesisMock = ReturnType<
  typeof vi.fn<(payload: Omit<StartSynthesisCommand, 'type'>) => Promise<void>>
>;

function controllerHarness(options: { selected: boolean; startSynthesis?: StartSynthesisMock }) {
  const feedback = { show: vi.fn() };
  const stopDictation = vi.fn(async (): Promise<void> => undefined);
  const cancelSynthesis = vi.fn();
  const startSynthesis =
    options.startSynthesis ??
    vi.fn(async (_payload: Omit<StartSynthesisCommand, 'type'>) => undefined);
  const controller = new ReadAloudController({
    feedback,
    getCatalog: () => TTS_CATALOG,
    getSettings: () => ({
      ...DEFAULT_PLUGIN_SETTINGS,
      selectedTtsModel: options.selected ? TTS_SELECTION : null,
      selectedTtsVoice: options.selected ? 'alba' : null,
    }),
    isDictationBusy: () => true,
    onStateChange: vi.fn(),
    sidecarConnection: {
      cancelSynthesis,
      reportSynthesisPlaybackPosition: vi.fn(),
      startSynthesis,
      subscribe: vi.fn(() => vi.fn()),
      subscribeSynthesisAudio: vi.fn(() => vi.fn()),
    },
    stopDictation,
  });
  return { cancelSynthesis, controller, feedback, startSynthesis, stopDictation };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveReadRange', () => {
  it('reads an exact selection regardless of selection direction', () => {
    const source = 'Before selected after';
    expect(resolveReadRange(editorFor(source, { ch: 0, line: 0 }, [15, 7]), source)).toEqual({
      from: 7,
      to: 15,
    });
  });

  it('reads the entire note when there is no selection', () => {
    const source = 'First block\ncontinues\n\nCurrent block\ncontinues\n\nLast';
    const editor = editorFor(source, { ch: 3, line: 4 });
    expect(resolveReadRange(editor, source)).toEqual({
      from: 0,
      to: source.length,
    });
  });
});

describe('ReadAloudController', () => {
  it('restarts settings changes from the current sentence', async () => {
    const harness = controllerHarness({ selected: true });
    const editor = editorFor('First sentence. Second sentence. Third sentence.', {
      ch: 0,
      line: 0,
    });

    await harness.controller.read(editor);
    playback.playThrough(0);
    await harness.controller.applySpeed(1.5);

    expect(harness.startSynthesis).toHaveBeenCalledTimes(2);
    expect(harness.startSynthesis.mock.calls[1]?.[0]).toMatchObject({
      chunks: [{ text: 'Second sentence.' }, { text: 'Third sentence.' }],
      speed: 1.5,
    });
  });

  it('validates TTS configuration before stopping dictation', async () => {
    const harness = controllerHarness({ selected: false });

    await harness.controller.read(editorFor('Speak this.', { ch: 0, line: 0 }));

    expect(harness.stopDictation).not.toHaveBeenCalled();
    expect(harness.startSynthesis).not.toHaveBeenCalled();
    expect(harness.feedback.show).toHaveBeenCalledOnce();
  });

  it('does not let a stale start failure clear a newer reading', async () => {
    const firstStart: { reject?: (error: unknown) => void } = {};
    const firstStartPromise = new Promise<void>((_resolve, reject) => {
      firstStart.reject = reject;
    });
    const startSynthesis = vi
      .fn<(payload: Omit<StartSynthesisCommand, 'type'>) => Promise<void>>()
      .mockReturnValueOnce(firstStartPromise)
      .mockResolvedValueOnce(undefined);
    const harness = controllerHarness({ selected: true, startSynthesis });
    const editor = editorFor('Speak this sentence.', { ch: 0, line: 0 });

    const first = harness.controller.read(editor);
    await vi.waitFor(() => expect(startSynthesis).toHaveBeenCalledOnce());
    await harness.controller.read(editor);
    if (firstStart.reject === undefined) throw new Error('first synthesis did not start');
    firstStart.reject(new Error('stale failure'));
    await first;

    expect(harness.controller.getState()).toBe('reading');
    expect(harness.feedback.show).not.toHaveBeenCalled();
  });

  it('does not start after Stop cancels a read waiting for dictation to drain', async () => {
    const stop: { complete?: () => void } = {};
    const stopDictation = new Promise<void>((resolve) => {
      stop.complete = resolve;
    });
    const harness = controllerHarness({ selected: true });
    harness.stopDictation.mockReturnValueOnce(stopDictation);

    const reading = harness.controller.read(editorFor('Speak this sentence.', { ch: 0, line: 0 }));
    await vi.waitFor(() => expect(harness.stopDictation).toHaveBeenCalledOnce());
    harness.controller.stop();
    if (stop.complete === undefined) throw new Error('dictation stop did not start');
    stop.complete();
    await reading;

    expect(harness.startSynthesis).not.toHaveBeenCalled();
    expect(harness.controller.getState()).toBe('idle');
  });

  it('cancels again when Stop races with an asynchronous sidecar start', async () => {
    const start: { complete?: () => void } = {};
    const startPromise = new Promise<void>((resolve) => {
      start.complete = resolve;
    });
    const startSynthesis = vi.fn(() => startPromise);
    const harness = controllerHarness({ selected: true, startSynthesis });

    const reading = harness.controller.read(editorFor('Speak this sentence.', { ch: 0, line: 0 }));
    await vi.waitFor(() => expect(startSynthesis).toHaveBeenCalledOnce());
    harness.controller.stop();
    if (start.complete === undefined) throw new Error('synthesis start did not begin');
    start.complete();
    await reading;

    expect(harness.cancelSynthesis).toHaveBeenCalledTimes(2);
    expect(harness.cancelSynthesis).toHaveBeenLastCalledWith(1);
    expect(harness.controller.getState()).toBe('idle');
  });
});
