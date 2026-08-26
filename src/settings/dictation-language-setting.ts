import { type DictationLanguage, dictationLanguageLabel } from '../language/dictation-language';
import type { ModelPickerOptions } from '../models/manage-models-modal';
import { t } from '../shared/i18n';
import type { UserFeedback } from '../shared/user-feedback';

interface DictationLanguageChangeDependencies {
  feedback: Pick<UserFeedback, 'show'>;
  hasSelectedModel: boolean;
  onModelChanged: () => void;
  openModelPicker: (options: ModelPickerOptions) => Promise<void>;
  persist: (language: DictationLanguage) => Promise<void>;
}

export async function applyDictationLanguageChange(
  language: DictationLanguage,
  dependencies: DictationLanguageChangeDependencies,
): Promise<void> {
  await dependencies.persist(language);
  if (dependencies.hasSelectedModel) return;

  dependencies.feedback.show({
    action: {
      label: t('settings.dictationLanguage.chooseModel'),
      run: () => {
        void dependencies
          .openModelPicker({ initialTask: 'stt', onChanged: dependencies.onModelChanged })
          .catch((error: unknown) => {
            dependencies.feedback.show({
              cause: error,
              intent: 'error',
              message: t('settings.dictationLanguage.openModelPickerFailed'),
            });
          });
      },
    },
    intent: 'action-required',
    key: 'dictation-model-required',
    message: t('settings.dictationLanguage.modelRequired', {
      language: dictationLanguageLabel(language),
    }),
  });
}
