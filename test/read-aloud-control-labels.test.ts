import { describe, expect, it } from 'vitest';

import { readAloudControlLabels } from '../src/tts/read-aloud-control-labels';

describe('read-aloud status controls', () => {
  it('exposes clear reading, pause, voice, and stop labels', () => {
    expect(readAloudControlLabels('reading', 'alba')).toEqual({
      pauseResume: 'Pause reading',
      state: 'Reading…',
      stop: 'Stop reading',
      voice: 'Voice: Alba',
    });
  });

  it('changes both state and action labels when paused', () => {
    expect(readAloudControlLabels('paused', 'cosette')).toMatchObject({
      pauseResume: 'Resume reading',
      state: 'Reading paused',
      voice: 'Voice: Cosette',
    });
  });
});
