import { AUDIO_FILE_ACCEPT, type AudioFileLike } from './audio-file-source';

export function pickAudioFile(): Promise<AudioFileLike | null> {
  const input = createEl('input');
  input.type = 'file';
  input.accept = AUDIO_FILE_ACCEPT;
  input.multiple = false;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.removeEventListener('cancel', onCancel);
      input.removeEventListener('change', onChange);
      resolve(file);
    };
    const onCancel = (): void => finish(null);
    const onChange = (): void => finish(input.files?.item(0) ?? null);

    input.addEventListener('cancel', onCancel);
    input.addEventListener('change', onChange);
    input.click();
  });
}
