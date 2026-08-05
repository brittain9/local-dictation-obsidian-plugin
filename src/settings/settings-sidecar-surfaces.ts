import { createCudaCompatibilityProvider } from '../sidecar/cuda-compatibility';
import {
  SettingsAttentionSection,
  type SettingsAttentionSectionDependencies,
} from './settings-attention-section';
import {
  SidecarSettingsSection,
  type SidecarSettingsSectionDependencies,
} from './sidecar-settings-section';

export interface SettingsSidecarSurfaceDependencies {
  advanced: Omit<SidecarSettingsSectionDependencies, 'getCudaCompatibility'>;
  attention: Omit<SettingsAttentionSectionDependencies, 'getCudaCompatibility'>;
  detectCudaCompatibility?: Parameters<typeof createCudaCompatibilityProvider>[0];
}

/**
 * Mounts both sidecar-related Settings surfaces as one display lifecycle.
 * Keeping the shared probe here makes duplicate probes structurally difficult,
 * while the attention section remains the sole active-install progress owner.
 */
export function mountSettingsSidecarSurfaces(
  attentionContainer: HTMLDivElement,
  advancedContainer: HTMLDivElement,
  deps: SettingsSidecarSurfaceDependencies,
): () => void {
  const getCudaCompatibility = createCudaCompatibilityProvider(deps.detectCudaCompatibility);
  const attention = new SettingsAttentionSection(attentionContainer, {
    ...deps.attention,
    getCudaCompatibility,
  });
  const advanced = new SidecarSettingsSection(advancedContainer, {
    ...deps.advanced,
    getCudaCompatibility,
  });
  const disposeAttention = attention.init();
  const disposeAdvanced = advanced.init();

  return () => {
    disposeAdvanced();
    disposeAttention();
  };
}
