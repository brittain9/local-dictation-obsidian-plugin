import { selectedModelEquals } from '../models/model-management-types';
import { asError } from '../shared/error-utils';
import type { PluginLogger } from '../shared/plugin-logger';
import {
  type ContextWindow,
  createCancelModelInstallCommand,
  createCancelSessionCommand,
  createContextResponseCommand,
  createGetModelStoreCommand,
  createGetSystemInfoCommand,
  createHealthCommand,
  createInstallModelCommand,
  createListInstalledModelsCommand,
  createListModelCatalogCommand,
  createProbeModelSelectionCommand,
  createProbeSystemAudioCommand,
  createRemoveModelCommand,
  createStartSessionCommand,
  createStopSessionCommand,
  type ErrorEvent,
  encodeAudioFrame,
  encodeJsonFrame,
  FramedMessageParser,
  type HealthOkEvent,
  type InstalledModelsEvent,
  JSON_FRAME_KIND,
  type ModelCatalogEvent,
  type ModelInstallUpdateEvent,
  type ModelProbeResultEvent,
  type ModelRemovedEvent,
  type ModelStoreEvent,
  parseEventFrame,
  type SessionStartedEvent,
  type SessionStoppedEvent,
  type SidecarCommand,
  type SidecarEvent,
  type StartSessionCommand,
  type SystemAudioProbeResultEvent,
  type SystemInfoEvent,
} from './protocol';
import { createSidecarStderrLogEntry } from './sidecar-logging';
import { type ResolveSidecarLaunchSpec, SidecarProcess } from './sidecar-process';

type SidecarEventListener = (event: SidecarEvent) => void;

export class SidecarError extends Error {
  readonly code: string;
  readonly details: string | undefined;
  readonly sessionId: string | undefined;

  constructor(event: ErrorEvent) {
    super(event.details ? `${event.message} (${event.details})` : event.message);
    this.name = 'SidecarError';
    this.code = event.code;
    this.details = event.details;
    this.sessionId = event.sessionId;
  }
}

interface PendingEventWaiter {
  description: string;
  matches: (event: SidecarEvent) => boolean;
  rejectOnError: (event: ErrorEvent) => boolean;
  reject: (error: Error) => void;
  resolve: (event: SidecarEvent) => void;
  timeoutHandle: number;
}

interface SidecarProcessLike {
  isRunning(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  write(frameBytes: Uint8Array): void;
}

interface SidecarConnectionOptions {
  createProcess?: (
    resolveLaunchSpec: ResolveSidecarLaunchSpec,
    handlers: ConstructorParameters<typeof SidecarProcess>[1],
  ) => SidecarProcessLike;
  getRequestTimeoutMs: () => number;
  logger?: PluginLogger;
  resolveLaunchSpec: ResolveSidecarLaunchSpec;
}

export class SidecarConnection {
  private readonly eventListeners = new Set<SidecarEventListener>();
  private readonly frameParser = new FramedMessageParser(parseEventFrame);
  private readonly pendingWaiters = new Set<PendingEventWaiter>();
  private readonly process: SidecarProcessLike;
  // Set true whenever the plugin itself initiates a stop (shutdown/restart),
  // so the onExit handler can distinguish clean swaps from real crashes.
  private expectedStop = false;

  constructor(private readonly options: SidecarConnectionOptions) {
    const handlers = {
      onExit: (code: number | null, signal: NodeJS.Signals | null) => {
        if (this.expectedStop) {
          this.options.logger?.debug(
            'sidecar',
            `sidecar stopped (code: ${String(code)}, signal: ${String(signal)})`,
          );
        } else {
          this.options.logger?.warn(
            'sidecar',
            `sidecar process exited unexpectedly (code: ${String(code)}, signal: ${String(signal)})`,
          );
        }
        this.expectedStop = false;
        this.frameParser.reset();
        this.rejectPendingWaiters(
          new Error(
            `Sidecar exited unexpectedly (code: ${String(code)}, signal: ${String(signal)}).`,
          ),
        );
      },
      onStderrLine: (line: string) => {
        const entry = createSidecarStderrLogEntry(line);

        if (entry !== null) {
          if (entry.level === 'warn') {
            this.options.logger?.warn('sidecar', entry.message);
          } else {
            this.options.logger?.debug('sidecar', entry.message);
          }
        }
      },
      onStdoutChunk: (chunk: Uint8Array) => {
        this.handleStdoutChunk(chunk);
      },
    };

    this.process =
      options.createProcess?.(options.resolveLaunchSpec, handlers) ??
      new SidecarProcess(options.resolveLaunchSpec, handlers);
  }

  async ensureStarted(): Promise<void> {
    await this.process.start();
  }

  async healthCheck(timeoutMs = this.options.getRequestTimeoutMs()): Promise<HealthOkEvent> {
    return this.sendCommandAndWait(
      createHealthCommand(),
      (event): event is HealthOkEvent => event.type === 'health_ok',
      'health_ok',
      timeoutMs,
    );
  }

  async getSystemInfo(timeoutMs = this.options.getRequestTimeoutMs()): Promise<SystemInfoEvent> {
    return this.sendCommandAndWait(
      createGetSystemInfoCommand(),
      (event): event is SystemInfoEvent => event.type === 'system_info',
      'system_info',
      timeoutMs,
    );
  }

  async getModelStore(
    modelStorePathOverride?: string,
    timeoutMs = this.options.getRequestTimeoutMs(),
  ): Promise<ModelStoreEvent> {
    return this.sendCommandAndWait(
      createGetModelStoreCommand(modelStorePathOverride),
      (event): event is ModelStoreEvent => event.type === 'model_store',
      'model_store',
      timeoutMs,
    );
  }

  async listModelCatalog(
    timeoutMs = this.options.getRequestTimeoutMs(),
  ): Promise<ModelCatalogEvent> {
    return this.sendCommandAndWait(
      createListModelCatalogCommand(),
      (event): event is ModelCatalogEvent => event.type === 'model_catalog',
      'model_catalog',
      timeoutMs,
    );
  }

  async listInstalledModels(
    modelStorePathOverride?: string,
    timeoutMs = this.options.getRequestTimeoutMs(),
  ): Promise<InstalledModelsEvent> {
    return this.sendCommandAndWait(
      createListInstalledModelsCommand(modelStorePathOverride),
      (event): event is InstalledModelsEvent => event.type === 'installed_models',
      'installed_models',
      timeoutMs,
    );
  }

  async probeModelSelection(
    payload: Parameters<typeof createProbeModelSelectionCommand>[0],
    timeoutMs = this.options.getRequestTimeoutMs(),
  ): Promise<ModelProbeResultEvent> {
    return this.sendCommandAndWait(
      createProbeModelSelectionCommand(payload),
      (event): event is ModelProbeResultEvent =>
        event.type === 'model_probe_result' &&
        selectedModelEquals(event.selection, payload.modelSelection),
      'model_probe_result',
      timeoutMs,
    );
  }

  async probeSystemAudio(timeoutMs = 75_000): Promise<SystemAudioProbeResultEvent> {
    return this.sendCommandAndWait(
      createProbeSystemAudioCommand(),
      (event): event is SystemAudioProbeResultEvent => event.type === 'system_audio_probe_result',
      'system_audio_probe_result',
      timeoutMs,
      (event) => event.sessionId === undefined,
    );
  }

  async removeModel(
    payload: Parameters<typeof createRemoveModelCommand>[0],
    timeoutMs = this.options.getRequestTimeoutMs(),
  ): Promise<ModelRemovedEvent> {
    return this.sendCommandAndWait(
      createRemoveModelCommand(payload),
      (event): event is ModelRemovedEvent =>
        event.type === 'model_removed' &&
        event.runtimeId === payload.runtimeId &&
        event.familyId === payload.familyId &&
        event.modelId === payload.modelId,
      `model_removed:${payload.runtimeId}:${payload.familyId}:${payload.modelId}`,
      timeoutMs,
    );
  }

  async installModel(
    payload: Parameters<typeof createInstallModelCommand>[0],
    timeoutMs = this.options.getRequestTimeoutMs(),
  ): Promise<ModelInstallUpdateEvent> {
    return this.sendCommandAndWait(
      createInstallModelCommand(payload),
      (event): event is ModelInstallUpdateEvent =>
        event.type === 'model_install_update' &&
        event.installId === payload.installId &&
        (event.state === 'failed' || event.state === 'queued'),
      `model_install_update:${payload.installId}`,
      timeoutMs,
      (event) => event.sessionId === undefined,
    );
  }

  cancelModelInstall(installId: string): void {
    if (!this.process.isRunning()) {
      return;
    }

    this.process.write(encodeJsonFrame(createCancelModelInstallCommand(installId)));
  }

  async startSession(
    payload: Omit<StartSessionCommand, 'type'>,
    timeoutMs = this.options.getRequestTimeoutMs(),
  ): Promise<SessionStartedEvent> {
    return this.sendCommandAndWait(
      createStartSessionCommand(payload),
      (event): event is SessionStartedEvent =>
        event.type === 'session_started' && event.sessionId === payload.sessionId,
      `session_started:${payload.sessionId}`,
      timeoutMs,
      (event) => !('sessionId' in event) || event.sessionId === payload.sessionId,
    );
  }

  async cancelSession(
    sessionId: string,
    timeoutMs = this.options.getRequestTimeoutMs(),
  ): Promise<SessionStoppedEvent> {
    return this.sendCommandAndWait(
      createCancelSessionCommand(sessionId),
      (event): event is SessionStoppedEvent =>
        event.type === 'session_stopped' && event.sessionId === sessionId,
      `session_stopped:${sessionId}`,
      timeoutMs,
      (event) => event.sessionId === undefined || event.sessionId === sessionId,
    );
  }

  requestStopSession(sessionId: string): void {
    if (!this.process.isRunning()) {
      return;
    }

    this.process.write(encodeJsonFrame(createStopSessionCommand(sessionId)));
  }

  async restart(startupTimeoutMs = this.options.getRequestTimeoutMs()): Promise<HealthOkEvent> {
    await this.shutdown();
    await this.ensureStarted();
    return this.healthCheck(startupTimeoutMs);
  }

  async shutdown(): Promise<void> {
    if (!this.process.isRunning()) {
      return;
    }

    this.expectedStop = true;
    this.rejectPendingWaiters(new Error('Sidecar is shutting down.'));

    // Stdin EOF is the shutdown signal. Avoid writing the redundant wire-level
    // shutdown command immediately before closing stdin; Node write() only
    // guarantees buffering, not that bytes flushed to the OS pipe.
    await this.process.stop();
  }

  sendAudioFrame(sessionId: string, frameBytes: Uint8Array): void {
    this.process.write(encodeAudioFrame(sessionId, frameBytes));
  }

  sendContextResponse(correlationId: string, context: ContextWindow | null): void {
    if (!this.process.isRunning()) {
      return;
    }

    this.process.write(encodeJsonFrame(createContextResponseCommand(correlationId, context)));
  }

  dispose(): void {
    this.eventListeners.clear();
    this.rejectPendingWaiters(new Error('SidecarConnection disposed'));
  }

  subscribe(listener: SidecarEventListener): () => void {
    this.eventListeners.add(listener);

    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private async sendCommandAndWait<TEvent extends SidecarEvent>(
    command: SidecarCommand,
    matches: (event: SidecarEvent) => event is TEvent,
    description: string,
    timeoutMs: number,
    rejectOnError?: (event: ErrorEvent) => boolean,
  ): Promise<TEvent> {
    await this.ensureStarted();

    return new Promise<TEvent>((resolve, reject) => {
      const waiter = this.createPendingWaiter(
        matches,
        description,
        timeoutMs,
        (event) => {
          resolve(event as TEvent);
        },
        reject,
        rejectOnError,
      );

      try {
        this.process.write(encodeJsonFrame(command));
      } catch (error) {
        window.clearTimeout(waiter.timeoutHandle);
        this.pendingWaiters.delete(waiter);
        reject(asError(error, `Failed to write sidecar command: ${command.type}`));
      }
    });
  }

  private createPendingWaiter(
    matches: (event: SidecarEvent) => boolean,
    description: string,
    timeoutMs: number,
    resolve: (event: SidecarEvent) => void,
    reject: (error: Error) => void,
    rejectOnError?: (event: ErrorEvent) => boolean,
  ): PendingEventWaiter {
    const waiter: PendingEventWaiter = {
      description,
      matches,
      reject,
      rejectOnError: rejectOnError ?? (() => true),
      resolve,
      timeoutHandle: window.setTimeout(() => {
        this.pendingWaiters.delete(waiter);
        waiter.reject(new Error(`Timed out waiting for sidecar event: ${description}`));
      }, timeoutMs),
    };

    this.pendingWaiters.add(waiter);
    return waiter;
  }

  private handleStdoutChunk(chunk: Uint8Array): void {
    const { fatal, frames } = this.frameParser.pushChunk(chunk);

    for (const frame of frames) {
      if (frame.kind !== JSON_FRAME_KIND) {
        this.options.logger?.warn(
          'protocol',
          'received an unexpected audio frame from the sidecar',
        );
        continue;
      }

      this.dispatchEvent(frame.envelope);
    }

    if (fatal !== undefined) {
      // The stream is unrecoverable: drain waiters with a meaningful error
      // and tear down the process. The unexpected-exit handler will surface
      // the crash and the next sendCommand respawns via ensureStarted().
      this.options.logger?.warn('protocol', 'fatal sidecar stream error; restarting', fatal);
      this.rejectPendingWaiters(new Error(`Sidecar stream parse failed: ${fatal.message}`));
      void this.process.stop();
    }
  }

  private dispatchEvent(event: SidecarEvent): void {
    if (event.type === 'model_install_update' && event.state === 'failed') {
      this.options.logger?.warn(
        'model',
        `install ${event.modelId} (${event.installId}) failed`,
        event.message,
        event.details,
      );
    }

    for (const listener of this.eventListeners) {
      listener(event);
    }

    for (const waiter of [...this.pendingWaiters]) {
      if (waiter.matches(event)) {
        window.clearTimeout(waiter.timeoutHandle);
        this.pendingWaiters.delete(waiter);
        waiter.resolve(event);
        continue;
      }

      if (event.type === 'error' && waiter.rejectOnError(event)) {
        window.clearTimeout(waiter.timeoutHandle);
        this.pendingWaiters.delete(waiter);
        waiter.reject(new SidecarError(event));
      }
    }
  }

  private rejectPendingWaiters(error: Error): void {
    for (const waiter of [...this.pendingWaiters]) {
      window.clearTimeout(waiter.timeoutHandle);
      this.pendingWaiters.delete(waiter);
      waiter.reject(error);
    }
  }
}
