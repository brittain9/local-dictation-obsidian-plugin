import type { Setting } from 'obsidian';

export function appendInfoTooltip(setting: Setting, tooltip: string): void {
  setting.addExtraButton((button) => {
    button.setIcon('info').setTooltip(tooltip);
  });
}
