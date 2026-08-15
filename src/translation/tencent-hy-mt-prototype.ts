import { isRecord } from '../shared/type-guards';
import { TranslationCancelledError } from './bergamot-client';
import type { TranslationLanguage } from './languages';

const PROTOTYPE_ENDPOINT = 'http://127.0.0.1:18080/v1/chat/completions';
const LANGUAGE_NAMES: Readonly<Record<TranslationLanguage, string>> = {
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  nl: 'Dutch',
  pt: 'Portuguese',
};

interface TencentHyMtPrototypeOptions {
  onProgress: (completed: number, total: number) => void;
  onReady: () => void;
  signal: AbortSignal;
  targetLanguage: TranslationLanguage;
  texts: readonly string[];
}

/**
 * PROTOTYPE: talks directly to a user-started, loopback-only llama.cpp server.
 * This exists only to evaluate HY-MT's translation experience inside Obsidian.
 */
export async function translateWithTencentHyMtPrototype(
  options: TencentHyMtPrototypeOptions,
): Promise<string[]> {
  const translations: string[] = [];
  options.onReady();

  for (const [index, text] of options.texts.entries()) {
    if (options.signal.aborted) throw new TranslationCancelledError();

    const response = await window.fetch(PROTOTYPE_ENDPOINT, {
      body: JSON.stringify({
        max_tokens: 512,
        messages: [
          {
            content: `Translate the following segment into ${LANGUAGE_NAMES[options.targetLanguage]}, without additional explanation.\n\n${text}`,
            role: 'user',
          },
        ],
        min_p: 0,
        repeat_penalty: 1.05,
        seed: 42,
        stream: false,
        temperature: 0.7,
        top_k: 20,
        top_p: 0.6,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: options.signal,
    }).catch((error: unknown) => {
      if (options.signal.aborted) throw new TranslationCancelledError();
      throw error;
    });

    if (!response.ok) {
      throw new Error(`HY-MT prototype request failed with HTTP ${response.status}.`);
    }

    const body: unknown = await response.json();
    const translation = readTranslation(body);
    if (translation === null) {
      throw new Error('HY-MT prototype returned no translation.');
    }

    translations.push(translation.trim());
    options.onProgress(index + 1, options.texts.length);
  }

  return translations;
}

function readTranslation(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices)) return null;
  const firstChoice: unknown = body.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return null;
  return typeof firstChoice.message.content === 'string' ? firstChoice.message.content : null;
}
