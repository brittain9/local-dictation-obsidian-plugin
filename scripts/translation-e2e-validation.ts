export function translationRegressionFailures(
  targetLanguage: string,
  translatedMarkdown: string,
): string[] {
  const lines = translatedMarkdown.split('\n');
  switch (targetLanguage) {
    case 'ja':
      return japaneseRegressionFailures(lines);
    case 'es':
      return spanishRegressionFailures(lines);
    default:
      return [];
  }
}

function japaneseRegressionFailures(lines: readonly string[]): string[] {
  const failures: string[] = [];
  const label = lines[0] ?? '';
  const shortcut = lines[1] ?? '';
  const midSentenceEmphasis = lines[2] ?? '';

  if (!/^\*\*高速翻訳\*\*/u.test(label)) {
    failures.push('the translated label is not exactly emphasized as 高速翻訳');
  }
  if (
    !shortcut.includes('閉じる前') ||
    shortcut.indexOf('**Ctrl+S**') < 0 ||
    shortcut.indexOf('押') < 0 ||
    shortcut.indexOf('**Ctrl+S**') > shortcut.indexOf('押')
  ) {
    failures.push('the Ctrl+S instruction does not preserve fluent Japanese word order');
  }
  if (!/\*\*太字の?テキスト\*\*/u.test(midSentenceEmphasis)) {
    failures.push('mid-sentence emphasis does not cover the translated “bold text” phrase');
  }
  return failures;
}

function spanishRegressionFailures(lines: readonly string[]): string[] {
  const failures: string[] = [];
  if (!/^\*\*Traducciones rápidas\*\*/iu.test(lines[0] ?? '')) {
    failures.push('the translated label is not exactly emphasized as Traducciones rápidas');
  }
  if (!/\*\*Ctrl\+S\*\*/u.test(lines[1] ?? '')) {
    failures.push('the Ctrl+S shortcut lost its emphasis');
  }
  if (!/\*\*texto\*\*\s+en\s+\*\*negrita\*\*/iu.test(lines[2] ?? '')) {
    failures.push('mid-sentence emphasis does not cover the translated “bold text” phrase');
  }
  return failures;
}
