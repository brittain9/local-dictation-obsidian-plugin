import { describe, expect, it } from 'vitest';

import { buildDictationLanguageMenuItems } from '../src/ui/dictation-language-menu';

describe('dictation ribbon language menu', () => {
  it('marks the current supported language and keeps choices enabled while idle', () => {
    expect(buildDictationLanguageMenuItems(['auto', 'en', 'es'], 'es', false)).toEqual([
      { disabled: false, label: 'Auto detect', language: 'auto', selected: false },
      { disabled: false, label: 'English', language: 'en', selected: false },
      { disabled: false, label: 'Español', language: 'es', selected: true },
    ]);
  });

  it('shows a now-unsupported saved language and disables changes during capture', () => {
    expect(buildDictationLanguageMenuItems(['en'], 'fr', true)).toEqual([
      { disabled: true, label: 'English', language: 'en', selected: false },
      { disabled: true, label: 'Français (unsupported)', language: 'fr', selected: true },
    ]);
  });
});
