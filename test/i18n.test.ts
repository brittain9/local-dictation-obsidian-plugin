import { describe, expect, it } from 'vitest';

import { resolveLocale, t } from '../src/shared/i18n';

describe('i18n', () => {
  it('returns the verbatim English source string', () => {
    expect(t('notice.dictationStartFailed')).toBe('Could not start dictation.');
  });

  it('interpolates string and number parameters', () => {
    expect(
      t('setup.sidecar.update.body', {
        engineLabel: '2 speech engines',
      }),
    ).toBe(
      'Download the current 2 speech engines to match this version of Local Dictation. Existing installs are replaced in place.',
    );
  });

  it('leaves a placeholder intact when its parameter is missing', () => {
    expect(t('setup.sidecar.update.body')).toContain('{engineLabel}');
    expect(t('setup.sidecar.update.body', {})).toContain('{engineLabel}');
  });

  it('matches supported regional tags on the base subtag', () => {
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('EN_gb')).toBe('en');
  });

  it('falls back to English for unsupported and empty locales', () => {
    expect(resolveLocale('ru')).toBe('en');
    expect(resolveLocale('')).toBe('en');
  });
});
