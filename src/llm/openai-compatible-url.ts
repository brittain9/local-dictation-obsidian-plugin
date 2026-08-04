export type OpenAiCompatibleBaseUrlValidation =
  | { normalizedUrl: string; valid: true }
  | {
      code: 'credentials' | 'empty' | 'not_absolute' | 'query_or_fragment' | 'scheme';
      valid: false;
    };

export function validateOpenAiCompatibleBaseUrl(value: string): OpenAiCompatibleBaseUrlValidation {
  const trimmed = value.trim().replace(/\/+$/u, '');
  if (trimmed.length === 0) {
    return { code: 'empty', valid: false };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { code: 'not_absolute', valid: false };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { code: 'scheme', valid: false };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { code: 'credentials', valid: false };
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return { code: 'query_or_fragment', valid: false };
  }
  return { normalizedUrl: trimmed, valid: true };
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}
