import type { AcceleratorId } from '../models/model-management-types';
import { t } from '../shared/i18n';
import type { PluginLogger } from '../shared/plugin-logger';
import type {
  AccelerationPreference,
  CompiledAdapterInfo,
  CompiledRuntimeInfo,
  SystemInfoEvent,
} from '../sidecar/protocol';

export function formatAcceleratorLabel(accelerator: AcceleratorId): string {
  switch (accelerator) {
    case 'cpu':
      return 'CPU';
    case 'cuda':
      return 'CUDA';
    case 'direct_ml':
      return 'DirectML';
    case 'metal':
      return 'Metal';
  }
}

interface EngineBackend {
  engineName: string;
  effective: AcceleratorId;
  missingGpu: { accelerator: AcceleratorId; reason: string } | null;
}

interface AccelerationFallback {
  engine: string;
  accelerator: AcceleratorId;
  reason: string;
}

interface AccelerationDescription {
  label: string;
  fallbacks: AccelerationFallback[];
}

/**
 * The subset of a `SystemInfoEvent` that acceleration reporting needs. Narrowed
 * so the settings tab can pass the model install manager's cached state, which
 * carries the same two lists without being a full event.
 */
export type AccelerationSnapshot = Pick<SystemInfoEvent, 'compiledAdapters' | 'compiledRuntimes'>;

export function describeAcceleration(
  systemInfo: AccelerationSnapshot | null,
  accelerationPreference: AccelerationPreference,
): AccelerationDescription {
  if (systemInfo === null) {
    return { label: t('settings.acceleration.pending'), fallbacks: [] };
  }

  if (accelerationPreference === 'cpu_only') {
    return { label: 'CPU', fallbacks: [] };
  }

  const backends = systemInfo.compiledAdapters.map((adapter) => {
    const runtime = systemInfo.compiledRuntimes.find((r) => r.runtimeId === adapter.runtimeId);
    return resolveEngineBackend(adapter, runtime);
  });

  const fallbacks: AccelerationFallback[] = [];
  for (const b of backends) {
    if (b.missingGpu !== null) {
      fallbacks.push({
        accelerator: b.missingGpu.accelerator,
        engine: b.engineName,
        reason: b.missingGpu.reason,
      });
    }
  }

  return { fallbacks, label: buildLabel(backends) };
}

function buildLabel(backends: EngineBackend[]): string {
  const first = backends[0];
  if (first === undefined) {
    return 'CPU';
  }

  const firstNonCpu = backends.find((b) => b.effective !== 'cpu');
  if (firstNonCpu === undefined) {
    const withMissing = backends.find((b) => b.missingGpu !== null);
    if (withMissing !== undefined && withMissing.missingGpu !== null) {
      return t('settings.acceleration.unavailable', {
        accelerator: formatAcceleratorLabel(withMissing.missingGpu.accelerator),
      });
    }
    return 'CPU';
  }

  const primary = firstNonCpu.effective;
  const exceptions = backends
    .filter((b) => b.effective !== primary)
    .map((b) => `${b.engineName}: ${formatAcceleratorLabel(b.effective)}`);

  if (exceptions.length === 0) {
    return formatAcceleratorLabel(primary);
  }
  return `${formatAcceleratorLabel(primary)} (${exceptions.join(', ')})`;
}

function resolveEngineBackend(
  adapter: CompiledAdapterInfo,
  runtime: CompiledRuntimeInfo | undefined,
): EngineBackend {
  const engineName = adapter.displayName;
  if (runtime === undefined || !adapter.familyCapabilities.supportsHardwareAcceleration) {
    return { engineName, effective: 'cpu', missingGpu: null };
  }
  const caps = runtime.runtimeCapabilities;
  const nonCpu = caps.availableAccelerators.filter((id) => id !== 'cpu');
  for (const id of nonCpu) {
    if (caps.acceleratorDetails[id]?.available === true) {
      return { engineName, effective: id, missingGpu: null };
    }
  }
  // The sidecar derives `availableAccelerators` as only the accelerators that
  // probed successfully, so a GPU that failed to initialise is by construction
  // absent from it. The fallback search has to read `acceleratorDetails`, which
  // is the only place the failure and its reason survive.
  for (const [id, detail] of Object.entries(caps.acceleratorDetails)) {
    if (id !== 'cpu' && detail?.available === false) {
      return {
        engineName,
        effective: 'cpu',
        missingGpu: {
          accelerator: id as AcceleratorId,
          reason: formatReason(detail.unavailableReason),
        },
      };
    }
  }
  return { engineName, effective: 'cpu', missingGpu: null };
}

function formatReason(reason: string | null): string {
  if (reason === null) {
    return t('settings.acceleration.unknownReason');
  }
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : t('settings.acceleration.unknownReason');
}

export function logAccelerationFallbacks(
  systemInfo: SystemInfoEvent,
  accelerationPreference: AccelerationPreference,
  logger: Pick<PluginLogger, 'warn'>,
): void {
  const { fallbacks } = describeAcceleration(systemInfo, accelerationPreference);
  for (const fb of fallbacks) {
    logger.warn(
      'acceleration',
      `${fb.engine}: ${formatAcceleratorLabel(fb.accelerator)} unavailable — ${fb.reason}`,
    );
  }
}
