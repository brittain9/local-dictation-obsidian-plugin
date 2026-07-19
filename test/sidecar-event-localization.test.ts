import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  KNOWN_NATIVE_EVENT_CODES,
  localizeSidecarEvent,
  SIDECAR_EVENT_TRANSLATION_KEYS,
} from '../src/sidecar/sidecar-event-localization';

describe('sidecar event localization', () => {
  it('includes every statically emitted native error and warning code', () => {
    const nativeSource = readRustSources(join(process.cwd(), 'native', 'src'));
    const emittedCodes = new Set<string>();
    const patterns = [/code:\s*"([a-z0-9_]+)"/gu, /internal_error_event\(\s*"([a-z0-9_]+)"/gu];

    for (const pattern of patterns) {
      for (const match of nativeSource.matchAll(pattern)) {
        const code = match[1];
        if (code !== undefined) emittedCodes.add(code);
      }
    }

    const knownCodes = new Set<string>(KNOWN_NATIVE_EVENT_CODES);
    expect(
      [...emittedCodes].filter((code) => !knownCodes.has(code)).sort(),
      'native error/warning codes must be added to the localization inventory',
    ).toEqual([]);
  });

  it('maps every inventoried native event code to a translated English message', () => {
    for (const code of KNOWN_NATIVE_EVENT_CODES) {
      expect(SIDECAR_EVENT_TRANSLATION_KEYS[code]).toBe(`sidecarError.${code}`);
      expect(
        localizeSidecarEvent({ code, message: 'raw sidecar message', type: 'error' }),
      ).not.toBe('raw sidecar message');
    }
  });

  it('preserves raw message and details for unknown future codes', () => {
    expect(
      localizeSidecarEvent({
        code: 'future_error',
        details: 'support detail',
        message: 'Future sidecar error',
        type: 'error',
      }),
    ).toBe('Future sidecar error (support detail)');
  });
});

function readRustSources(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readRustSources(path);
      return entry.isFile() && entry.name.endsWith('.rs') ? readFileSync(path, 'utf8') : '';
    })
    .join('\n');
}
