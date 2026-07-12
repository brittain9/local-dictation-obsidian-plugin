import { isRecord } from '../shared/type-guards';
import type { UserRule } from '../sidecar/protocol';

export const MAX_PERSONAL_CORRECTION_RULES = 100;
export const MAX_CORRECTION_SOURCE_CHARS = 120;
export const MAX_CORRECTION_REPLACEMENT_CHARS = 300;

export interface PersonalCorrectionRule extends UserRule {
  enabled: boolean;
  id: string;
}

export interface CorrectionPreview {
  appliedRuleCount: number;
  replacementCount: number;
  text: string;
}

export function readPersonalCorrectionRules(value: unknown): PersonalCorrectionRule[] {
  if (!Array.isArray(value)) return [];

  const accepted: PersonalCorrectionRule[] = [];
  const seenIds = new Set<string>();
  const seenMatchers = new Set<string>();
  for (const candidate of value) {
    if (accepted.length >= MAX_PERSONAL_CORRECTION_RULES) break;
    if (!isRecord(candidate)) continue;

    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const source = typeof candidate.source === 'string' ? candidate.source : '';
    const replacement = typeof candidate.replacement === 'string' ? candidate.replacement : '';
    if (
      id.length === 0 ||
      id.length > 100 ||
      seenIds.has(id) ||
      source.trim().length === 0 ||
      countCharacters(source) > MAX_CORRECTION_SOURCE_CHARS ||
      countCharacters(replacement) > MAX_CORRECTION_REPLACEMENT_CHARS ||
      source === replacement
    ) {
      continue;
    }

    const rule = {
      caseSensitive: candidate.caseSensitive === true,
      enabled: candidate.enabled !== false,
      id,
      replacement,
      source,
      wholeWord: candidate.wholeWord !== false,
    };
    const matcher = matcherSignature(rule);
    if (seenMatchers.has(matcher)) continue;

    accepted.push(rule);
    seenIds.add(id);
    seenMatchers.add(matcher);
  }
  return accepted;
}

export function toActiveUserRules(rules: readonly PersonalCorrectionRule[]): UserRule[] {
  return rules
    .filter((rule) => rule.enabled)
    .map(({ caseSensitive, replacement, source, wholeWord }) => ({
      caseSensitive,
      replacement,
      source,
      wholeWord,
    }));
}

export function validatePersonalCorrectionRule(
  rule: PersonalCorrectionRule,
  existingRules: readonly PersonalCorrectionRule[],
): string | null {
  if (rule.source.trim().length === 0) {
    return 'Enter the text Local Dictation should replace.';
  }
  if (countCharacters(rule.source) > MAX_CORRECTION_SOURCE_CHARS) {
    return `Text to replace must be ${MAX_CORRECTION_SOURCE_CHARS} characters or fewer.`;
  }
  if (countCharacters(rule.replacement) > MAX_CORRECTION_REPLACEMENT_CHARS) {
    return `Replacement must be ${MAX_CORRECTION_REPLACEMENT_CHARS} characters or fewer.`;
  }
  if (rule.source === rule.replacement) {
    return 'The replacement must differ from the original text.';
  }
  const signature = matcherSignature(rule);
  const duplicate = existingRules.some(
    (candidate) => candidate.id !== rule.id && matcherSignature(candidate) === signature,
  );
  if (duplicate) {
    return 'A correction with the same text and matching options already exists.';
  }
  return null;
}

export function previewPersonalCorrections(
  text: string,
  rules: readonly UserRule[],
): CorrectionPreview {
  let result = text;
  let replacementCount = 0;
  let appliedRuleCount = 0;

  for (const rule of rules) {
    const applied = applyRule(result, rule);
    result = applied.text;
    replacementCount += applied.replacementCount;
    if (applied.replacementCount > 0) appliedRuleCount += 1;
  }

  return { appliedRuleCount, replacementCount, text: result };
}

function applyRule(text: string, rule: UserRule): { replacementCount: number; text: string } {
  const matcher = new RegExp(escapeRegExp(rule.source), rule.caseSensitive ? 'gu' : 'giu');
  let output = '';
  let copiedUntil = 0;
  let replacementCount = 0;

  for (const match of text.matchAll(matcher)) {
    const start = match.index;
    const matchedText = match[0];
    const end = start + matchedText.length;
    if (rule.wholeWord && !hasWordBoundaries(text, start, end)) continue;

    output += text.slice(copiedUntil, start);
    output += rule.replacement;
    copiedUntil = end;
    replacementCount += 1;
  }

  if (replacementCount === 0) return { replacementCount: 0, text };
  output += text.slice(copiedUntil);
  return { replacementCount, text: output };
}

function hasWordBoundaries(text: string, start: number, end: number): boolean {
  return (
    !isWordCharacter(previousCharacter(text, start)) && !isWordCharacter(nextCharacter(text, end))
  );
}

function previousCharacter(text: string, offset: number): string | null {
  const codeUnit = text.charCodeAt(offset - 1);
  if (Number.isNaN(codeUnit)) return null;
  const width = codeUnit >= 0xdc00 && codeUnit <= 0xdfff ? 2 : 1;
  return text.slice(Math.max(0, offset - width), offset);
}

function nextCharacter(text: string, offset: number): string | null {
  const codePoint = text.codePointAt(offset);
  if (codePoint === undefined) return null;
  return String.fromCodePoint(codePoint);
}

function isWordCharacter(character: string | null): boolean {
  return character !== null && /[\p{L}\p{N}_]/u.test(character);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function matcherSignature(rule: UserRule): string {
  const source = rule.caseSensitive ? rule.source : rule.source.toLowerCase();
  return JSON.stringify([source, rule.caseSensitive, rule.wholeWord]);
}
