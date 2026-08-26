import { describe, expect, it } from 'vitest';

import { buildRustQualityCommands } from '../scripts/check-rust.mjs';

describe('Rust quality commands', () => {
  it('keeps dependency-resolving checks locked to Cargo.lock', () => {
    const commands = buildRustQualityCommands({ PATH: '/test/bin' });
    const clippy = commands.find(({ args }) => args[0] === 'clippy');
    const test = commands.find(({ args }) => args[0] === 'test');

    expect(clippy?.args).toContain('--locked');
    expect(test?.args).toContain('--locked');
    expect(clippy?.env).toMatchObject({ DOCS_RS: '1', PATH: '/test/bin' });
  });
});
