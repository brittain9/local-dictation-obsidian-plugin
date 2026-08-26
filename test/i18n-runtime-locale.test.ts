import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  getLanguage: () => 'es-MX',
}));

import { t } from '../src/shared/i18n';

describe('i18n runtime locale selection', () => {
  it('loads the catalog for the base subtag of the Obsidian language', () => {
    expect(t('common.cancel')).toBe('Cancelar');
  });
});
