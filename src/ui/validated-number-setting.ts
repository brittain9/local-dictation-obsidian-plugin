import { Setting } from 'obsidian';

export interface BoundedNumberOptions {
  integer?: boolean;
  max: number;
  min: number;
}

export type BoundedNumberValidation =
  | { message: string; valid: false }
  | { valid: true; value: number };

export interface ValidatedNumberSettingOptions extends BoundedNumberOptions {
  desc: string;
  disabled?: boolean;
  name: string;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}

let nextDescriptionId = 0;

export function validateBoundedNumber(
  input: string,
  options: BoundedNumberOptions,
): BoundedNumberValidation {
  const trimmed = input.trim();
  const numberPattern =
    options.integer === true ? /^[+-]?\d+$/u : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u;
  const value = Number(trimmed);
  const valid =
    trimmed.length > 0 &&
    numberPattern.test(trimmed) &&
    Number.isFinite(value) &&
    value >= options.min &&
    value <= options.max &&
    (options.integer !== true || Number.isInteger(value));

  if (valid) {
    return { valid: true, value };
  }

  return {
    message:
      options.integer === true
        ? `Enter a whole number from ${options.min} to ${options.max}.`
        : `Enter a number from ${options.min} to ${options.max}.`,
    valid: false,
  };
}

export function addValidatedNumberSetting(
  parent: HTMLElement,
  options: ValidatedNumberSettingOptions,
): Setting {
  const setting = new Setting(parent).setName(options.name).setDesc(options.desc);
  const descriptionId = `local-dictation-number-description-${++nextDescriptionId}`;
  setting.descEl.id = descriptionId;
  setting.descEl.setAttribute('aria-live', 'polite');

  setting.addText((text) => {
    text.inputEl.type = 'number';
    text.inputEl.inputMode = options.integer === true ? 'numeric' : 'decimal';
    text.inputEl.min = String(options.min);
    text.inputEl.max = String(options.max);
    text.inputEl.step = String(options.step ?? 1);
    text.inputEl.setAttribute('aria-label', options.name);
    text.inputEl.setAttribute('aria-describedby', descriptionId);
    text.setValue(String(options.value));
    text.setDisabled(options.disabled === true);
    text.onChange((input) => {
      const validation = validateBoundedNumber(input, options);
      const message = validation.valid ? '' : validation.message;
      text.inputEl.setCustomValidity(message);
      text.inputEl.toggleAttribute('aria-invalid', !validation.valid);
      setting.setDesc(validation.valid ? options.desc : validation.message);
      if (validation.valid) {
        options.onChange(validation.value);
      }
    });
  });

  return setting;
}
