import { Notice } from 'obsidian';

import type { FeedbackPresenter } from './user-feedback';

export function createObsidianFeedbackPresenter(): FeedbackPresenter {
  return {
    present(presentation) {
      const message =
        presentation.action === undefined
          ? presentation.message
          : createFragment((fragment) => {
              fragment.createDiv({ text: presentation.message });
              fragment
                .createEl('a', { href: '#', text: presentation.action?.label ?? '' })
                .addEventListener('click', (event) => {
                  event.preventDefault();
                  presentation.action?.run();
                });
            });
      const notice = new Notice(message, presentation.durationMs);

      return {
        dismiss() {
          notice.hide();
        },
      };
    },
  };
}
