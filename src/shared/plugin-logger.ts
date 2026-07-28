export interface PluginLogger {
  debug(category: string, message: string, ...data: unknown[]): void;
  warn(category: string, message: string, ...data: unknown[]): void;
  error(category: string, message: string, ...data: unknown[]): void;
}

export function createPluginLogger(isDeveloperMode: () => boolean): PluginLogger {
  return {
    debug(category, message, ...data) {
      if (!isDeveloperMode()) return;
      console.debug(`[Speech Kit] [${category}]`, message, ...data);
    },
    warn(category, message, ...data) {
      console.warn(`[Speech Kit] [${category}]`, message, ...data);
    },
    error(category, message, ...data) {
      console.error(`[Speech Kit] [${category}]`, message, ...data);
    },
  };
}
