import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmModal } from '../src/ui/confirm-modal';
import { Setting } from './__mocks__/obsidian';

describe('ConfirmModal', () => {
  beforeEach(() => {
    Setting.reset();
  });

  it('runs an asynchronous confirmation once and disables both actions while pending', async () => {
    let finish: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const modal = new ConfirmModal({} as never, {
      confirmLabel: 'Delete',
      message: 'Delete this item?',
      onConfirm,
      title: 'Confirm deletion',
    });
    const close = vi.spyOn(modal, 'close');
    modal.open();

    const cancelButton = Setting.buttonNamed('Cancel');
    const confirmButton = Setting.buttonNamed('Delete');
    await confirmButton.click();
    await confirmButton.click();

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(cancelButton.disabled).toBe(true);
    expect(confirmButton.disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();

    finish?.();
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });

  it('keeps the modal open and makes retry possible after a rejected action', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('private implementation detail');
    });
    const modal = new ConfirmModal({} as never, {
      confirmLabel: 'Reset',
      message: 'Reset these settings?',
      onConfirm,
      title: 'Confirm reset',
    });
    const close = vi.spyOn(modal, 'close');
    modal.open();

    const cancelButton = Setting.buttonNamed('Cancel');
    const confirmButton = Setting.buttonNamed('Reset');
    await confirmButton.click();
    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(confirmButton.disabled).toBe(false);
    });

    expect(close).not.toHaveBeenCalled();
    expect(cancelButton.disabled).toBe(false);
    const errorEl = modal.contentEl.querySelector('.local-stt-confirm-modal__error');
    expect(errorEl?.textContent).toBe('Could not complete this action. Try again.');
    expect(errorEl?.textContent).not.toContain('private implementation detail');

    await confirmButton.click();
    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });
  });
});
