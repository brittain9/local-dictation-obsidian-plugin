import { build } from 'esbuild';

export async function bundleBergamotWorker({ minify = false } = {}) {
  const result = await build({
    bundle: true,
    entryPoints: ['src/translation/bergamot.worker.ts'],
    format: 'iife',
    logLevel: 'silent',
    minify,
    platform: 'browser',
    sourcemap: false,
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  const workerSource = result.outputFiles[0]?.text;
  if (workerSource === undefined) {
    throw new Error('Failed to bundle the Bergamot translation worker source.');
  }
  return workerSource;
}
