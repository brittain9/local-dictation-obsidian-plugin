import { describe, expect, it } from 'vitest';

import { describeCatalogLanguageSupport } from '../src/models/language-support';

describe('describeCatalogLanguageSupport', () => {
  it('recognizes normalized English-only catalog tags', () => {
    expect(describeCatalogLanguageSupport([' EN ', 'en-US', 'en'])).toBe('English only');
  });

  it('does not present a multilingual model as app-level multilingual support', () => {
    expect(describeCatalogLanguageSupport(['en', 'fr', 'de'])).toBe('Includes English');
  });

  it('flags a model that cannot serve the current English-only pipeline', () => {
    expect(describeCatalogLanguageSupport(['fr', 'de'])).toBe('Not available for English');
  });

  it('treats missing language metadata conservatively', () => {
    expect(describeCatalogLanguageSupport(['', '  '])).toBe('Language support unverified');
  });
});
