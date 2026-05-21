import { describe, expect, it } from 'vitest';

import { truncateLeadingText, truncateTrailingText } from '../src/shared/text-truncation';

// truncateLeadingText keeps the START of the text, dropping the tail at the
// nicest available boundary (paragraph > sentence > whitespace).
//
// truncateTrailingText keeps the END of the text, dropping the head at the
// same boundary preference.
//
// These functions assemble note-context windows for the LLM; an off-by-one in
// boundary detection silently leaks half-words into the prompt.

describe('truncateLeadingText', () => {
  it('returns the text unchanged when within budget', () => {
    expect(truncateLeadingText('hello world', 100)).toEqual({
      text: 'hello world',
      truncated: false,
    });
  });

  it('reports truncation but returns empty when maxChars is zero or negative', () => {
    expect(truncateLeadingText('hello', 0)).toEqual({ text: '', truncated: true });
    expect(truncateLeadingText('hello', -5)).toEqual({ text: '', truncated: true });
  });

  it('reports not-truncated for empty input at any budget', () => {
    expect(truncateLeadingText('', 0)).toEqual({ text: '', truncated: false });
    expect(truncateLeadingText('', 100)).toEqual({ text: '', truncated: false });
  });

  it('cuts at the last paragraph break when one exists in budget', () => {
    const text = 'first paragraph.\n\nsecond paragraph.\n\nthird paragraph.';
    const result = truncateLeadingText(
      text,
      'first paragraph.\n\nsecond paragraph.\n\n'.length + 3,
    );

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('first paragraph.\n\nsecond paragraph.');
  });

  it('falls back to the last sentence boundary when no paragraph break fits', () => {
    const text = 'One sentence. Two sentence. Three sentence. Four.';
    const result = truncateLeadingText(text, 'One sentence. Two sentence. '.length + 3);

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('One sentence. Two sentence.');
  });

  it('falls back to the last whitespace boundary when no sentence fits', () => {
    const result = truncateLeadingText('alpha beta gamma delta', 14);

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('alpha beta');
  });

  it('trims at the hard cutoff when no boundary exists at all', () => {
    const result = truncateLeadingText('supercalifragilistic', 8);

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('supercal');
  });
});

describe('truncateTrailingText', () => {
  it('returns the text unchanged when within budget', () => {
    expect(truncateTrailingText('hello world', 100)).toEqual({
      text: 'hello world',
      truncated: false,
    });
  });

  it('reports truncation but returns empty when maxChars is zero or negative', () => {
    expect(truncateTrailingText('hello', 0)).toEqual({ text: '', truncated: true });
    expect(truncateTrailingText('hello', -1)).toEqual({ text: '', truncated: true });
  });

  it('starts the kept tail at the first paragraph break in the window', () => {
    // Trailing keeps the last maxChars then drops everything up to and
    // including the first boundary, so the kept text starts cleanly.
    const text = 'first.\n\nsecond.\n\nthird.';
    const result = truncateTrailingText(text, 'second.\n\nthird.'.length + 1);

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('third.');
  });

  it('falls back to the first sentence boundary when no paragraph break fits', () => {
    const text = 'One sentence. Two sentence. Three sentence. Four sentence.';
    const result = truncateTrailingText(text, 'Three sentence. Four sentence.'.length + 1);

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('Four sentence.');
  });

  it('falls back to whitespace boundary when no sentence end fits', () => {
    // Last 14 chars of 'alpha beta gamma delta' is 'ta gamma delta';
    // first whitespace is the space after 'ta', so the kept tail is everything after that.
    const result = truncateTrailingText('alpha beta gamma delta', 14);

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('gamma delta');
  });

  it('trims at the hard cutoff when no boundary exists at all', () => {
    const result = truncateTrailingText('supercalifragilistic', 8);

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('gilistic');
  });
});
