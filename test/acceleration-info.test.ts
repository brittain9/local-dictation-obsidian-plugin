import { describe, expect, it } from 'vitest';

import type {
  AcceleratorAvailability,
  AcceleratorId,
  RuntimeCapabilitiesRecord,
} from '../src/models/model-management-types';
import { type AccelerationSnapshot, describeAcceleration } from '../src/settings/acceleration-info';
import type { CompiledAdapterInfo, CompiledRuntimeInfo } from '../src/sidecar/protocol';

const CUDA_UNAVAILABLE = 'The selected engine could not initialize CUDA, so it is running on CPU.';

/**
 * Mirrors what the sidecar actually sends: `RuntimeCapabilities::from_details`
 * derives `availableAccelerators` from the details that probed successfully, so
 * a GPU that failed appears only in `acceleratorDetails`.
 */
function snapshot(
  details: Partial<Record<AcceleratorId, AcceleratorAvailability>>,
  engineNames: string[] = ['Moonshine'],
  supportsHardwareAcceleration = true,
): AccelerationSnapshot {
  const runtimeCapabilities: RuntimeCapabilitiesRecord = {
    acceleratorDetails: details,
    availableAccelerators: (Object.entries(details) as [AcceleratorId, AcceleratorAvailability][])
      .filter(([, detail]) => detail.available)
      .map(([id]) => id),
    supportedModelFormats: ['onnx'],
  };

  const runtime: CompiledRuntimeInfo = {
    displayName: 'ONNX Runtime',
    runtimeCapabilities,
    runtimeId: 'onnx_runtime',
  };

  const compiledAdapters = engineNames.map(
    (displayName) =>
      ({
        displayName,
        familyCapabilities: {
          supportsHardwareAcceleration,
        },
        familyId: 'moonshine',
        runtimeId: 'onnx_runtime',
      }) as CompiledAdapterInfo,
  );

  return { compiledAdapters, compiledRuntimes: [runtime] };
}

describe('describeAcceleration', () => {
  it('reports a GPU that failed to initialise even though it is absent from availableAccelerators', () => {
    const description = describeAcceleration(
      snapshot({
        cpu: { available: true, unavailableReason: null },
        cuda: { available: false, unavailableReason: CUDA_UNAVAILABLE },
      }),
      'auto',
    );

    expect(description.label).toBe('CPU (CUDA unavailable)');
    expect(description.fallbacks).toEqual([
      { accelerator: 'cuda', engine: 'Moonshine', reason: CUDA_UNAVAILABLE },
    ]);
  });

  it('reports the fallback once per engine so the row can de-duplicate a shared runtime failure', () => {
    const description = describeAcceleration(
      snapshot(
        {
          cpu: { available: true, unavailableReason: null },
          cuda: { available: false, unavailableReason: CUDA_UNAVAILABLE },
        },
        ['Moonshine', 'Nemotron'],
      ),
      'auto',
    );

    expect(description.fallbacks.map((fallback) => fallback.engine)).toEqual([
      'Moonshine',
      'Nemotron',
    ]);
    expect(new Set(description.fallbacks.map((fallback) => fallback.reason)).size).toBe(1);
  });

  it('reports the accelerator when it initialised', () => {
    const description = describeAcceleration(
      snapshot({
        cpu: { available: true, unavailableReason: null },
        cuda: { available: true, unavailableReason: null },
      }),
      'auto',
    );

    expect(description.label).toBe('CUDA');
    expect(description.fallbacks).toEqual([]);
  });

  it('reports CPU when the runtime has CUDA but the model family cannot use it', () => {
    const description = describeAcceleration(
      snapshot(
        {
          cpu: { available: true, unavailableReason: null },
          cuda: { available: true, unavailableReason: null },
        },
        ['Moonshine'],
        false,
      ),
      'auto',
    );

    expect(description.label).toBe('CPU');
    expect(description.fallbacks).toEqual([]);
  });

  it('does not report a fallback when the user asked for CPU', () => {
    const description = describeAcceleration(
      snapshot({
        cpu: { available: true, unavailableReason: null },
        cuda: { available: false, unavailableReason: CUDA_UNAVAILABLE },
      }),
      'cpu_only',
    );

    expect(description.label).toBe('CPU');
    expect(description.fallbacks).toEqual([]);
  });
});
