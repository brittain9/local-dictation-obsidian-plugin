export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export type ClipboardProvider = () => ClipboardWriter | null | undefined;

export async function tryWriteClipboardText(
  getClipboard: ClipboardProvider,
  text: string,
): Promise<boolean> {
  try {
    const clipboard = getClipboard();
    if (clipboard === null || clipboard === undefined) {
      return false;
    }
    await clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard implementations can echo the requested text in thrown errors.
    // Collapse every failure so callers cannot expose or log private details.
    return false;
  }
}
