import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const modelArgument = process.argv[2];
if (modelArgument === undefined) {
  console.error(
    'Usage: npm run prototype:tencent-translation -- /path/to/HY-MT1.5-1.8B-Q4_K_M.gguf',
  );
  process.exitCode = 1;
} else {
  const executable = process.env.LLAMA_SERVER_BIN ?? 'llama-server';
  const server = spawn(
    executable,
    [
      '-m',
      resolve(modelArgument),
      '-ngl',
      'all',
      '-c',
      '4096',
      '-np',
      '1',
      '--host',
      '127.0.0.1',
      '--port',
      '18080',
      '--no-webui',
    ],
    { stdio: 'inherit' },
  );

  server.on('error', (error) => {
    console.error(`Could not start ${executable}: ${error.message}`);
    process.exitCode = 1;
  });
  server.on('exit', (code, signal) => {
    if (signal !== null) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
}
