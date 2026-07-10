import type { PluginLogger } from './plugin-logger';

export type FeedbackIntent = 'information' | 'success' | 'warning' | 'error' | 'action-required';

export interface FeedbackAction {
  label: string;
  run: () => void;
}

export interface FeedbackRequest {
  action?: FeedbackAction;
  cause?: unknown;
  intent: FeedbackIntent;
  key?: string;
  message: string;
}

export interface FeedbackPresentation {
  action?: FeedbackAction;
  durationMs: number;
  message: string;
}

export interface FeedbackPresentationHandle {
  dismiss(): void;
}

export interface FeedbackPresenter {
  present(presentation: FeedbackPresentation): FeedbackPresentationHandle;
}

export interface UserFeedback {
  dispose(): void;
  show(request: FeedbackRequest): void;
}

interface UserFeedbackDependencies {
  logger: PluginLogger;
  presenter: FeedbackPresenter;
}

interface ActiveFeedback {
  expiryTimerId: number | null;
  handle: FeedbackPresentationHandle;
}

const DEFAULT_DURATION_MS: Readonly<Record<FeedbackIntent, number>> = {
  'action-required': 0,
  error: 10_000,
  information: 5_000,
  success: 4_000,
  warning: 8_000,
};

export function createUserFeedback(dependencies: UserFeedbackDependencies): UserFeedback {
  const activeByKey = new Map<string, ActiveFeedback>();

  const release = (key: string, active: ActiveFeedback, dismiss: boolean): void => {
    if (active.expiryTimerId !== null) {
      window.clearTimeout(active.expiryTimerId);
    }
    if (dismiss) {
      active.handle.dismiss();
    }
    if (activeByKey.get(key) === active) {
      activeByKey.delete(key);
    }
  };

  return {
    dispose() {
      for (const [key, active] of activeByKey) {
        release(key, active, true);
      }
    },
    show(request) {
      if (request.key !== undefined) {
        const active = activeByKey.get(request.key);
        if (active !== undefined) {
          release(request.key, active, true);
        }
      }

      logFeedback(dependencies.logger, request);

      let handle: FeedbackPresentationHandle | null = null;
      const action =
        request.action === undefined
          ? undefined
          : {
              label: request.action.label,
              run: () => {
                if (request.key !== undefined) {
                  const active = activeByKey.get(request.key);
                  if (active !== undefined && active.handle === handle) {
                    release(request.key, active, true);
                  } else {
                    handle?.dismiss();
                  }
                } else {
                  handle?.dismiss();
                }
                request.action?.run();
              },
            };
      const durationMs = DEFAULT_DURATION_MS[request.intent];
      handle = dependencies.presenter.present({
        ...(action === undefined ? {} : { action }),
        durationMs,
        message: request.message.startsWith('Local Dictation')
          ? request.message
          : `Local Dictation: ${request.message}`,
      });

      if (request.key !== undefined) {
        const key = request.key;
        const active: ActiveFeedback = { expiryTimerId: null, handle };
        activeByKey.set(key, active);
        if (durationMs > 0) {
          active.expiryTimerId = window.setTimeout(() => {
            release(key, active, false);
          }, durationMs);
        }
      }
    },
  };
}

function logFeedback(logger: PluginLogger, request: FeedbackRequest): void {
  const message = `${request.intent}: ${request.message}`;
  const data = request.cause === undefined ? [] : [request.cause];

  switch (request.intent) {
    case 'information':
    case 'success':
      logger.debug('feedback', message, ...data);
      return;
    case 'warning':
    case 'action-required':
      logger.warn('feedback', message, ...data);
      return;
    case 'error':
      logger.error('feedback', message, ...data);
  }
}
