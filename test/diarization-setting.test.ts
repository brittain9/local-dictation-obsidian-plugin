import { describe, expect, it } from 'vitest';

import { diarizationSettingDescription } from '../src/settings/diarization-setting';

describe('diarizationSettingDescription', () => {
  it('shows the speaker-label limitation only for a streaming model', () => {
    const limitation = 'Not applied while a streaming (live) model is selected';

    expect(diarizationSettingDescription(true)).toContain(limitation);
    expect(diarizationSettingDescription(false)).not.toContain(limitation);
  });
});
