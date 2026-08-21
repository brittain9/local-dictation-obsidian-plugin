import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

import { build } from 'esbuild';

const JSON_FRAME_KIND = 0x01;
const FRAME_HEADER_LENGTH = 5;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const TRANSLATION_TIMEOUT_MS = 2 * 60_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const MODEL_TRIPLE = {
  familyId: 'tencent_hy_mt',
  modelId: 'tencent_hy_mt_1_5_1_8b_q4_k_m',
  runtimeId: 'llama_cpp',
};
const SOURCE_LANGUAGE = 'en';
const TARGET_LANGUAGE = 'es';
const TEST_MARKDOWN = `The meeting starts at nine tomorrow morning.
Keep \`npm run check\`, [[Speech Kit]], #release, and $x + y$ unchanged.
Read [the specification](https://example.com/spec).

| Tool | Status |
| --- | --- |
| [[Nemotron]] | Ready |
`;

const sidecarPath = resolve(
  process.env.LOCAL_DICTATION_NATURAL_SIDECAR?.trim() ||
    `native/target/${process.env.LOCAL_DICTATION_NATURAL_PROFILE?.trim() || 'debug'}/local-dictation-sidecar`,
);
const configuredModelStore = process.env.LOCAL_DICTATION_NATURAL_MODEL_STORE?.trim();
const modelStorePath =
  configuredModelStore === undefined || configuredModelStore === ''
    ? await mkdtemp(join(tmpdir(), 'speech-kit-hy-mt-smoke-'))
    : resolve(configuredModelStore);
const accelerationPreference = process.env.LOCAL_DICTATION_NATURAL_ACCELERATION?.trim() || 'auto';
const skipInstall = process.env.LOCAL_DICTATION_NATURAL_SKIP_INSTALL === '1';
const sidecar = startSidecar(sidecarPath);

try {
  if (!skipInstall) {
    const installId = crypto.randomUUID();
    sidecar.send({
      ...MODEL_TRIPLE,
      installId,
      modelStorePathOverride: modelStorePath,
      type: 'install_model',
    });
    const install = await sidecar.waitFor(
      (event) =>
        event.type === 'model_install_update' &&
        event.installId === installId &&
        (event.state === 'completed' || event.state === 'failed' || event.state === 'cancelled'),
      INSTALL_TIMEOUT_MS,
      'HY-MT model install',
    );
    if (install.state !== 'completed') {
      throw new Error(
        `HY-MT model install ended ${install.state}: ${install.message ?? 'no message'}`,
      );
    }
  }

  const {
    protectedMarkerModeForTranslation,
    rebuildTranslatedMarkdown,
    segmentMarkdownForTranslation,
    translatableTexts,
  } = await loadTypeScriptModule('src/translation/markdown-segmentation.ts');
  const segments = segmentMarkdownForTranslation(TEST_MARKDOWN, {
    protectedMarkerMode: protectedMarkerModeForTranslation(
      'tencent_hy_mt',
      SOURCE_LANGUAGE,
      TARGET_LANGUAGE,
    ),
  });
  const texts = translatableTexts(segments);
  const translationId = crypto.randomUUID();
  const startedAt = performance.now();
  sidecar.send({
    accelerationPreference,
    modelSelection: { kind: 'catalog_model', ...MODEL_TRIPLE },
    modelStorePathOverride: modelStorePath,
    sourceLanguage: SOURCE_LANGUAGE,
    targetLanguage: TARGET_LANGUAGE,
    texts,
    translationId,
    type: 'start_translation',
  });
  const terminal = await sidecar.waitFor(
    (event) =>
      event.translationId === translationId &&
      (event.type === 'translation_complete' || event.type === 'translation_error'),
    TRANSLATION_TIMEOUT_MS,
    'HY-MT translation',
  );
  if (terminal.type === 'translation_error') {
    throw new Error(`HY-MT translation failed (${terminal.code}): ${terminal.message}`);
  }

  const rebuilt = rebuildTranslatedMarkdown(segments, terminal.translations);
  assertSmokeOutput(rebuilt, texts.length, terminal.translations);
  process.stdout.write(
    `${JSON.stringify({
      inferenceMs: Math.round(performance.now() - startedAt),
      modelStorePath,
      sidecarPath,
      translatedMarkdown: rebuilt.text,
    })}\n`,
  );
} finally {
  await sidecar.stop();
}

function assertSmokeOutput(rebuilt, expectedUnits, translations) {
  const translatedMarkdown = rebuilt.text;
  if (
    rebuilt.sourceUnitsKept !== 0 ||
    !translatedMarkdown.toLocaleLowerCase('es').includes('mañana') ||
    !translatedMarkdown.includes('`npm run check`') ||
    !translatedMarkdown.includes('[[Speech Kit]]') ||
    !translatedMarkdown.includes('#release') ||
    !translatedMarkdown.includes('$x + y$') ||
    !translatedMarkdown.includes('(https://example.com/spec)') ||
    !translatedMarkdown.includes('| --- | --- |') ||
    !translatedMarkdown.includes('[[Nemotron]]') ||
    expectedUnits === 0
  ) {
    throw new Error(
      `HY-MT smoke output failed: ${JSON.stringify({ rebuilt, expectedUnits, translations })}`,
    );
  }
}

function startSidecar(executable) {
  const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  const waiters = new Set();
  let buffered = Buffer.alloc(0);
  let terminalError = null;
  let stderr = '';

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.byteLength >= FRAME_HEADER_LENGTH) {
      const kind = buffered.readUInt8(0);
      const payloadLength = buffered.readUInt32LE(1);
      if (kind !== JSON_FRAME_KIND) {
        terminalError = new Error(`Unexpected sidecar frame kind: ${kind}`);
        rejectWaiters();
        return;
      }
      if (buffered.byteLength < FRAME_HEADER_LENGTH + payloadLength) return;
      const payload = buffered.subarray(FRAME_HEADER_LENGTH, FRAME_HEADER_LENGTH + payloadLength);
      buffered = buffered.subarray(FRAME_HEADER_LENGTH + payloadLength);
      let event;
      try {
        event = JSON.parse(payload.toString('utf8'));
      } catch (error) {
        terminalError = error instanceof Error ? error : new Error(String(error));
        rejectWaiters();
        return;
      }
      events.push(event);
      for (const waiter of [...waiters]) {
        if (waiter.matches(event)) {
          waiters.delete(waiter);
          clearTimeout(waiter.timeout);
          waiter.resolve(event);
        }
      }
    }
  });
  child.once('error', (error) => {
    terminalError = error;
    rejectWaiters();
  });
  child.once('exit', (code, signal) => {
    if (terminalError === null && code !== 0) {
      terminalError = new Error(
        `Sidecar exited ${code === null ? `from ${signal ?? 'an unknown signal'}` : `with code ${code}`}: ${stderr.trim()}`,
      );
    }
    rejectWaiters();
  });

  return {
    send(command) {
      const payload = Buffer.from(JSON.stringify(command));
      const frame = Buffer.alloc(FRAME_HEADER_LENGTH + payload.byteLength);
      frame.writeUInt8(JSON_FRAME_KIND, 0);
      frame.writeUInt32LE(payload.byteLength, 1);
      payload.copy(frame, FRAME_HEADER_LENGTH);
      if (!child.stdin.write(frame)) {
        throw new Error('Sidecar stdin is backpressured before the smoke command could be sent.');
      }
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        this.send({ type: 'shutdown' });
        await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
      } catch {
        child.kill();
        await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
      }
    },
    waitFor(matches, timeoutMs, label) {
      const existing = events.find(matches);
      if (existing !== undefined) return Promise.resolve(existing);
      if (terminalError !== null) return Promise.reject(terminalError);
      return new Promise((resolvePromise, reject) => {
        const waiter = {
          matches,
          reject,
          resolve: resolvePromise,
          timeout: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(`${label} did not finish within ${Math.round(timeoutMs / 1000)} seconds.`),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };

  function rejectWaiters() {
    const error = terminalError ?? new Error(`Sidecar exited unexpectedly: ${stderr.trim()}`);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    waiters.clear();
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Sidecar did not stop before the timeout.'));
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

async function loadTypeScriptModule(entryPoint) {
  const result = await build({
    bundle: true,
    entryPoints: [entryPoint],
    format: 'esm',
    logLevel: 'silent',
    minify: true,
    platform: 'node',
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  const source = result.outputFiles[0]?.text;
  if (source === undefined) {
    throw new Error(`Failed to bundle ${entryPoint}.`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
