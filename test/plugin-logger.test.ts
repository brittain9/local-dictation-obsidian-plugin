import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPluginLogger } from '../src/shared/plugin-logger';

describe('plugin logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gates debug records while preserving warnings and errors outside developer mode', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let developerMode = false;
    const logger = createPluginLogger(() => developerMode);
    const cause = new Error('network failed');

    logger.debug('installer', 'download started');
    logger.warn('installer', 'download is slow');
    logger.error('installer', 'download failed', cause);

    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[Local Dictation] [installer]', 'download is slow');
    expect(error).toHaveBeenCalledWith('[Local Dictation] [installer]', 'download failed', cause);

    developerMode = true;
    logger.debug('installer', 'retry started');

    expect(debug).toHaveBeenCalledWith('[Local Dictation] [installer]', 'retry started');
  });
});
