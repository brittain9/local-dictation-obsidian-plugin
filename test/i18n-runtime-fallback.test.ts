import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  getLanguage: () => 'ru',
}));

import { t } from '../src/shared/i18n';

describe('i18n runtime fallback', () => {
  it('uses English when Obsidian has no registered catalog', () => {
    expect(t('common.cancel')).toBe('Cancel');
  });
});
