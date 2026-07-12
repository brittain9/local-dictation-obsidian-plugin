import { describePresetTiming, resolveActivePresetEntry } from '../llm/presets';
import type { PluginSettings } from '../settings/plugin-settings';

type LlmSidebarSettings = Pick<
  PluginSettings,
  | 'llmFeaturesEnabled'
  | 'llmPostprocessActivePresetRef'
  | 'llmPostprocessMode'
  | 'llmPostprocessUserPresets'
>;

interface ActiveLlmSidebarPresentation {
  emptyState: null;
  state: 'active';
  statusLabel: 'On';
  summary: string;
}

interface InactiveLlmSidebarPresentation {
  emptyState: {
    description: string;
    icon: string;
    title: string;
  };
  state: 'off' | 'unavailable';
  statusLabel: 'Off' | 'Unavailable';
  summary: string;
}

export type LlmSidebarPresentation = ActiveLlmSidebarPresentation | InactiveLlmSidebarPresentation;

export function resolveLlmSidebarPresentation(
  settings: LlmSidebarSettings,
): LlmSidebarPresentation {
  if (!settings.llmFeaturesEnabled) {
    return {
      emptyState: {
        description: 'Enable LLM features in Local Dictation settings to configure transforms.',
        icon: 'settings-2',
        title: 'LLM features are unavailable',
      },
      state: 'unavailable',
      statusLabel: 'Unavailable',
      summary: 'Enable LLM features in settings',
    };
  }

  if (settings.llmPostprocessMode === 'off') {
    return {
      emptyState: {
        description:
          'Dictation inserts the raw Whisper transcript. Turn on Transform when you want cleanup, rewriting, or summaries.',
        icon: 'file-text',
        title: 'Raw transcript mode',
      },
      state: 'off',
      statusLabel: 'Off',
      summary: 'Raw Whisper transcript',
    };
  }

  const { preset } = resolveActivePresetEntry(
    settings.llmPostprocessActivePresetRef,
    settings.llmPostprocessUserPresets,
  );
  const timing = preset.timing ?? settings.llmPostprocessMode;

  return {
    emptyState: null,
    state: 'active',
    statusLabel: 'On',
    summary: `${preset.label} · ${describePresetTiming(timing)}`,
  };
}
