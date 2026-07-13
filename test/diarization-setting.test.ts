import { describe, expect, it } from 'vitest';

import { diarizationSettingDescription } from '../src/settings/diarization-setting';

describe('diarizationSettingDescription', () => {
  it('shows the speaker-label limitation only for a streaming model', () => {
    const limitation = 'require a batch model';

    expect(diarizationSettingDescription(true)).toContain(limitation);
    expect(diarizationSettingDescription(false)).not.toContain(limitation);
    expect(diarizationSettingDescription(false)).toBe('Label each phrase by speaker.');
  });
});
