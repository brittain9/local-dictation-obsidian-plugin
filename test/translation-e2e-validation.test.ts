import { describe, expect, it } from 'vitest';

import { translationRegressionFailures } from '../scripts/translation-e2e-validation';

const GOOD_JAPANESE = `**高速翻訳**:迅速な言語変換を実現。
閉じる前に**Ctrl+S**を押して、作業を保存してください。
条項の中央に**太字のテキスト**が書かれた文がここで続きます。`;

describe('real-model translation regression validation', () => {
  it('accepts semantically aligned Japanese Markdown', () => {
    expect(translationRegressionFailures('ja', GOOD_JAPANESE)).toEqual([]);
  });

  it.each([
    [
      'mangled labels',
      `**Fast Transtレーションズ**:迅速な言語変換を実現。
閉じる前に**Ctrl+S**を押して、作業を保存してください。
条項の中央に**太字のテキスト**が書かれた文がここで続きます。`,
    ],
    [
      'fragmented word order',
      `**高速翻訳**:迅速な言語変換を実現。
押してください**Ctrl+S** 閉鎖前に仕事を保存するため。
条項の中央に**太字のテキスト**が書かれた文がここで続きます。`,
    ],
    [
      'misplaced emphasis',
      `**高速翻訳**:迅速な言語変換を実現。
閉じる前に**Ctrl+S**を押して、作業を保存してください。
条項の中央**に太字の**テキストが書かれた文がここで続きます。`,
    ],
  ])('rejects %s from known broken implementations', (_name, output) => {
    expect(translationRegressionFailures('ja', output)).not.toEqual([]);
  });
});
