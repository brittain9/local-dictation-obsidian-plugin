import { describe, expect, it } from 'vitest';

import {
  READ_ALOUD_SPEED_PRESETS,
  readAloudControlLabels,
} from '../src/tts/read-aloud-control-labels';

describe('read-aloud status controls', () => {
  it('offers the approved active-player speed presets', () => {
    expect(READ_ALOUD_SPEED_PRESETS).toEqual([0.75, 1, 1.25, 1.5, 2]);
  });

  it('exposes clear reading, pause, voice, and stop labels', () => {
    expect(
      readAloudControlLabels('reading', {
        modelName: 'Pocket TTS English',
        speed: 1,
        voiceId: 'alba',
      }),
    ).toEqual({
      model: 'Model: Pocket TTS English',
      pauseResume: 'Pause reading',
      speed: 'Speed: 1×',
      speedValue: '1×',
      state: 'Reading…',
      stop: 'Stop reading',
      voice: 'Voice: Alba',
    });
  });

  it('changes both state and action labels when paused', () => {
    expect(
      readAloudControlLabels('paused', {
        modelName: 'Pocket TTS French',
        speed: 1.5,
        voiceId: 'cosette',
      }),
    ).toMatchObject({
      model: 'Model: Pocket TTS French',
      pauseResume: 'Resume reading',
      speed: 'Speed: 1.5×',
      speedValue: '1.5×',
      state: 'Reading paused',
      voice: 'Voice: Cosette',
    });
  });
});
