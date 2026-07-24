import {
  createSidecarInUsePredicate,
  type SpeechSessionPredicates,
} from '../sidecar/sidecar-speech-interlock';
import type { SidecarInstallActionDeps } from './sidecar-settings-section';

export type StartupSidecarInstallActionSources = Omit<
  SidecarInstallActionDeps,
  'isSidecarInUse'
> & {
  speechPredicates: SpeechSessionPredicates;
};

export function buildStartupSidecarInstallActionDeps(
  sources: StartupSidecarInstallActionSources,
): SidecarInstallActionDeps {
  const { speechPredicates, ...deps } = sources;
  return {
    ...deps,
    isSidecarInUse: createSidecarInUsePredicate(speechPredicates),
  };
}
