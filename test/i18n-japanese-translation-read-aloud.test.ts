import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  getLanguage: () => 'ja',
}));

import { t } from '../src/shared/i18n';
import { translationLanguageLabel } from '../src/translation/languages';

describe('Japanese translation read-aloud copy', () => {
  it('renders a natural accessible label without duplicating the language suffix', () => {
    expect(
      t('translation.modal.readAloud', {
        language: translationLanguageLabel('ja'),
      }),
    ).toBe('翻訳を日本語で読み上げる');
  });
});
