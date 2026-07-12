import { describe, expect, it } from 'vitest';
import {
  type PersonalCorrectionRule,
  previewPersonalCorrectionDraft,
  previewPersonalCorrections,
  readPersonalCorrectionRules,
  toActiveUserRules,
  validatePersonalCorrectionRule,
} from '../src/corrections/correction-rules';
import correctionGoldenCases from './fixtures/personal-corrections-golden.json';

interface CorrectionGoldenCase {
  draft: PersonalCorrectionRule;
  existingRules: PersonalCorrectionRule[];
  expectedText: string;
  inputText: string;
  isNew: boolean;
  name: string;
}

const goldenCases = correctionGoldenCases as CorrectionGoldenCase[];

function rule(overrides: Partial<PersonalCorrectionRule> = {}): PersonalCorrectionRule {
  return {
    caseSensitive: false,
    enabled: true,
    id: 'rule-1',
    replacement: 'Kubernetes',
    source: 'kuber netes',
    wholeWord: true,
    ...overrides,
  };
}

describe('personal correction rules', () => {
  it.each(goldenCases)('$name', ({ draft, existingRules, expectedText, inputText, isNew }) => {
    expect(previewPersonalCorrectionDraft(inputText, existingRules, draft, isNew).text).toBe(
      expectedText,
    );
  });

  it('applies literal rules in order and treats replacement metacharacters literally', () => {
    const preview = previewPersonalCorrections('A KUBER NETES cluster.', [
      rule(),
      rule({ id: 'rule-2', replacement: '$& platform', source: 'Kubernetes cluster' }),
    ]);

    expect(preview).toEqual({
      appliedRuleCount: 2,
      replacementCount: 2,
      text: 'A $& platform.',
    });
  });

  it('honors whole-word and case-sensitive matching', () => {
    expect(
      previewPersonalCorrections('obsidian Obsidian obsidianite', [
        rule({ caseSensitive: true, replacement: 'Obsidian', source: 'obsidian' }),
      ]).text,
    ).toBe('Obsidian Obsidian obsidianite');
    expect(
      previewPersonalCorrections('preobsidian obsidian_post obsidian', [
        rule({ replacement: 'Obsidian', source: 'obsidian' }),
      ]).text,
    ).toBe('preobsidian obsidian_post Obsidian');
  });

  it('keeps enabled-rule order while dropping ids and disabled rules from the wire payload', () => {
    expect(
      toActiveUserRules([
        rule(),
        rule({ enabled: false, id: 'disabled', source: 'skip' }),
        rule({ id: 'last', source: 'last' }),
      ]),
    ).toEqual([
      {
        caseSensitive: false,
        replacement: 'Kubernetes',
        source: 'kuber netes',
        wholeWord: true,
      },
      {
        caseSensitive: false,
        replacement: 'Kubernetes',
        source: 'last',
        wholeWord: true,
      },
    ]);
  });

  it('skips malformed persisted entries without discarding later valid rules', () => {
    expect(
      readPersonalCorrectionRules([null, rule(), rule({ id: 'duplicate', source: 'KUBER NETES' })]),
    ).toEqual([rule()]);
  });

  it('rejects ambiguous duplicate matching semantics', () => {
    expect(
      validatePersonalCorrectionRule(rule({ id: 'new', source: 'KUBER NETES' }), [rule()]),
    ).toMatch(/already exists/u);
    expect(
      validatePersonalCorrectionRule(rule({ caseSensitive: true, id: 'new' }), [rule()]),
    ).toBeNull();
  });

  it('rejects edge whitespace that canonical segment joining cannot preserve', () => {
    expect(validatePersonalCorrectionRule(rule({ source: ' kuber netes' }), [])).toMatch(
      /whitespace/u,
    );
    expect(validatePersonalCorrectionRule(rule({ replacement: 'Kubernetes ' }), [])).toMatch(
      /whitespace/u,
    );
  });
});
