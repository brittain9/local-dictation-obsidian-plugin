import { builtinModules } from 'node:module';
import process from 'node:process';
import { build, context } from 'esbuild';

const args = new Set(process.argv.slice(2));
const isWatch = args.has('watch');
const isProduction = args.has('production');

const externalModules = [
  '@codemirror/state',
  '@codemirror/view',
  'electron',
  'obsidian',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

const mainBuildOptions = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  logLevel: 'info',
  minify: isProduction,
  sourcemap: isProduction ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  external: externalModules,
  plugins: [buildModePlugin(), pcmRecorderWorkletSourcePlugin(), bergamotWorkerSourcePlugin()],
};

async function buildAll() {
  await build(mainBuildOptions);
}

async function main() {
  if (isWatch) {
    const watcher = await context(mainBuildOptions);

    await watcher.watch();
    console.log('[esbuild] watching for changes');
    return;
  }

  await buildAll();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function buildModePlugin() {
  const buildModeId = 'virtual:build-mode';

  return {
    name: 'build-mode',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^virtual:build-mode$/ }, () => ({
        namespace: 'build-mode',
        path: buildModeId,
      }));

      buildContext.onLoad(
        {
          filter: /^virtual:build-mode$/,
          namespace: 'build-mode',
        },
        () => ({
          contents: `export const IS_PRODUCTION_BUILD = ${JSON.stringify(isProduction)};`,
          loader: 'js',
        }),
      );
    },
  };
}

function pcmRecorderWorkletSourcePlugin() {
  const workletSourceId = 'virtual:pcm-recorder-worklet-source';

  return {
    name: 'pcm-recorder-worklet-source',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^virtual:pcm-recorder-worklet-source$/ }, () => ({
        namespace: 'pcm-recorder-worklet-source',
        path: workletSourceId,
      }));

      buildContext.onLoad(
        {
          filter: /^virtual:pcm-recorder-worklet-source$/,
          namespace: 'pcm-recorder-worklet-source',
        },
        async () => {
          const bundledWorklet = await build({
            bundle: true,
            entryPoints: ['src/audio/pcm-recorder.worklet.ts'],
            format: 'esm',
            logLevel: 'silent',
            minify: isProduction,
            platform: 'browser',
            sourcemap: false,
            target: 'es2022',
            treeShaking: true,
            write: false,
          });
          const workletSource = bundledWorklet.outputFiles[0]?.text;

          if (workletSource === undefined) {
            throw new Error('Failed to bundle the recorder worklet source.');
          }

          return {
            contents: `export const PCM_RECORDER_WORKLET_SOURCE = ${JSON.stringify(workletSource)};`,
            loader: 'js',
          };
        },
      );
    },
  };
}

function bergamotWorkerSourcePlugin() {
  const workerSourceId = 'virtual:bergamot-worker-source';

  return {
    name: 'bergamot-worker-source',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^virtual:bergamot-worker-source$/ }, () => ({
        namespace: 'bergamot-worker-source',
        path: workerSourceId,
      }));

      buildContext.onLoad(
        {
          filter: /^virtual:bergamot-worker-source$/,
          namespace: 'bergamot-worker-source',
        },
        async () => {
          const bundledWorker = await build({
            bundle: true,
            entryPoints: ['src/translation/bergamot.worker.ts'],
            format: 'iife',
            logLevel: 'silent',
            minify: isProduction,
            platform: 'browser',
            sourcemap: false,
            target: 'es2022',
            treeShaking: true,
            write: false,
          });
          const workerSource = bundledWorker.outputFiles[0]?.text;

          if (workerSource === undefined) {
            throw new Error('Failed to bundle the Bergamot translation worker source.');
          }

          return {
            contents: `export const BERGAMOT_WORKER_SOURCE = ${JSON.stringify(workerSource)};`,
            loader: 'js',
          };
        },
      );
    },
  };
}
