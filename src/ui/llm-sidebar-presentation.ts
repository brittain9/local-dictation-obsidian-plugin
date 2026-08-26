import { describePresetTiming, resolveActivePresetEntry } from '../llm/presets';
import type { PluginSettings } from '../settings/plugin-settings';
import { t } from '../shared/i18n';

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
  statusLabel: string;
  summary: string;
}

interface InactiveLlmSidebarPresentation {
  emptyState: {
    description: string;
    icon: string;
    title: string;
  };
  state: 'off' | 'unavailable';
  statusLabel: string;
  summary: string;
}

export type LlmSidebarPresentation = ActiveLlmSidebarPresentation | InactiveLlmSidebarPresentation;

export function resolveLlmSidebarPresentation(
  settings: LlmSidebarSettings,
): LlmSidebarPresentation {
  if (!settings.llmFeaturesEnabled) {
    return {
      emptyState: {
        description: t('llm.sidebar.unavailable.description'),
        icon: 'settings-2',
        title: t('llm.sidebar.unavailable.title'),
      },
      state: 'unavailable',
      statusLabel: t('common.unavailable'),
      summary: t('llm.sidebar.unavailable.summary'),
    };
  }

  if (settings.llmPostprocessMode === 'off') {
    return {
      emptyState: {
        description: t('llm.sidebar.off.description'),
        icon: 'file-text',
        title: t('llm.sidebar.off.title'),
      },
      state: 'off',
      statusLabel: t('common.off'),
      summary: t('llm.sidebar.off.summary'),
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
    statusLabel: t('common.on'),
    summary: t('llm.sidebar.active.summary', {
      preset: preset.label,
      timing: describePresetTiming(timing),
    }),
  };
}
