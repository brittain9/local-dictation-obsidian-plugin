import type { ButtonComponent } from 'obsidian';
import { describe, expect, it } from 'vitest';

import { styleDestructiveButton } from '../src/ui/destructive-button';

describe('styleDestructiveButton', () => {
  it('uses the modern secondary destructive style when available', () => {
    const fake = createFakeButton(true);

    const result = styleDestructiveButton(fake.button);

    expect(result).toBe(fake.button);
    expect(fake.calls).toEqual({ cta: 0, destructive: 1, warning: 0 });
  });

  it('composes destructive and primary styles for a modern primary action', () => {
    const fake = createFakeButton(true);

    styleDestructiveButton(fake.button, { primary: true });

    expect(fake.calls).toEqual({ cta: 1, destructive: 1, warning: 0 });
  });

  it('falls back to the legacy warning style before Obsidian 1.13', () => {
    const fake = createFakeButton(false);

    styleDestructiveButton(fake.button, { primary: true });

    expect(fake.calls).toEqual({ cta: 0, destructive: 0, warning: 1 });
  });
});

function createFakeButton(hasDestructiveApi: boolean): {
  button: ButtonComponent;
  calls: { cta: number; destructive: number; warning: number };
} {
  const calls = { cta: 0, destructive: 0, warning: 0 };
  const compatible = {
    setCta: () => {
      calls.cta += 1;
      return compatible;
    },
    setDestructive: hasDestructiveApi
      ? () => {
          calls.destructive += 1;
          return compatible;
        }
      : undefined,
    setWarning: () => {
      calls.warning += 1;
      return compatible;
    },
  };

  return { button: compatible as unknown as ButtonComponent, calls };
}
