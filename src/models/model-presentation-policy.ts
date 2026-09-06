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
  installConfirmation: {
    confirmLabel: string;
    link: { href: string; text: string } | null;
    message: string;
    title: string;
  } | null;
  warning: string | null;
}

const POLICY_TAGS = new Set(['high-cpu', 'may-buffer', 'heavy']);

export function resolveModelPresentationPolicy(model: CatalogModelRecord): ModelPresentationPolicy {
  const highCpu = model.uxTags.includes('high-cpu');
  const mayBuffer = model.uxTags.includes('may-buffer');
  const heavy = model.uxTags.includes('heavy');
  const requiresTermsReview = model.uxTags.includes('requires-terms-review');
  const size = formatBytes(
    model.artifacts
      .filter((artifact) => artifact.required)
      .reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
  );
  const badges = model.uxTags
    .filter((tag) => POLICY_TAGS.has(tag))
    .map((tag) => ({
      label:
        tag === 'high-cpu'
          ? t('models.tag.highCpu')
          : tag === 'may-buffer'
            ? t('models.tag.mayBuffer')
            : t('models.tag.heavy'),
      tag,
      tone: 'warning' as const,
    }));
  const warning = heavy
    ? t('models.manage.heavyWarning', { size })
    : mayBuffer
      ? t('models.manage.performanceWarning')
      : null;

  return {
    badges,
    installConfirmation: requiresTermsReview
      ? {
          confirmLabel: t('models.manage.installTermsConfirm'),
          link: { href: model.licenseUrl, text: t('models.manage.installTermsLink') },
          message: t('models.manage.installTermsMessage', {
            license: model.licenseLabel,
            model: model.displayName,
            size,
          }),
          title: t('models.manage.installTermsTitle'),
        }
      : highCpu || mayBuffer || heavy
        ? {
            confirmLabel: t('common.install'),
            link: null,
            message: t(
              heavy
                ? 'models.manage.heavyInstallWarningMessage'
                : 'models.manage.installWarningMessage',
              {
                model: model.displayName,
                size,
              },
            ),
            title: t('models.manage.installWarningTitle'),
          }
        : null,
    warning,
  };
}
