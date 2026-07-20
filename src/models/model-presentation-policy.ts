import { formatBytes } from '../shared/format-utils';
import { t } from '../shared/i18n';
import type { CatalogModelRecord } from './model-management-types';

export type ModelBadgeTone = 'neutral' | 'warning';

export interface ModelPresentationBadge {
  label: string;
  tag: string;
  tone: ModelBadgeTone;
}

export interface ModelPresentationPolicy {
  badges: ModelPresentationBadge[];
  installConfirmation: { message: string; title: string } | null;
  warning: string | null;
}

const POLICY_TAGS = new Set(['high-cpu', 'may-buffer']);

export function resolveModelPresentationPolicy(model: CatalogModelRecord): ModelPresentationPolicy {
  const highCpu = model.uxTags.includes('high-cpu');
  const mayBuffer = model.uxTags.includes('may-buffer');
  const badges = model.uxTags
    .filter((tag) => POLICY_TAGS.has(tag))
    .map((tag) => ({
      label: tag === 'high-cpu' ? t('models.tag.highCpu') : t('models.tag.mayBuffer'),
      tag,
      tone: 'warning' as const,
    }));
  const warning = mayBuffer ? t('models.manage.performanceWarning') : null;

  return {
    badges,
    installConfirmation:
      highCpu || mayBuffer
        ? {
            message: t('models.manage.installWarningMessage', {
              model: model.displayName,
              size: formatBytes(
                model.artifacts
                  .filter((artifact) => artifact.required)
                  .reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
              ),
            }),
            title: t('models.manage.installWarningTitle'),
          }
        : null,
    warning,
  };
}
