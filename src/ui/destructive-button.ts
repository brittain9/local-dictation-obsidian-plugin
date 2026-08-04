import type { ButtonComponent } from 'obsidian';

interface CompatibleDestructiveButton {
  setCta(): ButtonComponent;
  setDestructive?: () => ButtonComponent;
  setWarning(): ButtonComponent;
}

export function styleDestructiveButton(
  button: ButtonComponent,
  options: { primary?: boolean } = {},
): ButtonComponent {
  const compatible = button as unknown as CompatibleDestructiveButton;

  if (typeof compatible.setDestructive === 'function') {
    compatible.setDestructive();
    if (options.primary === true) compatible.setCta();
  } else {
    // Obsidian before 1.13 exposes only the legacy destructive style.
    compatible.setWarning();
  }

  return button;
}
