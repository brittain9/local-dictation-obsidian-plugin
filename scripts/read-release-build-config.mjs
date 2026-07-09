import { appendFile, readFile } from 'node:fs/promises';

const CONFIG_PATH = '.github/release-build-config.json';
const CONFIG_OUTPUT_NAMES = {
  ggmlNative: 'ggml-native',
  ortCudaVersion: 'ort-cuda-version',
  cudaToolkitVersion: 'cuda-toolkit-version',
  cudaArchitectures: 'cuda-architectures',
  windowsCudaSubpackagesManifest: 'windows-cuda-subpackages-manifest',
  windowsCudaRustCacheEnvVars: 'windows-cuda-rust-cache-env-vars',
};
const OUTPUT_NAMES = {
  nodeVersion: 'node-version',
  rustToolchain: 'rust-toolchain',
  ...CONFIG_OUTPUT_NAMES,
};

const [configJson, mise, rustToolchainToml] = await Promise.all([
  readFile(CONFIG_PATH, 'utf8'),
  readFile('.mise.toml', 'utf8'),
  readFile('rust-toolchain.toml', 'utf8'),
]);
const config = JSON.parse(configJson);
const configKeys = Object.keys(CONFIG_OUTPUT_NAMES);
const unknownKeys = Object.keys(config).filter((key) => !configKeys.includes(key));

if (unknownKeys.length > 0) {
  throw new Error(`${CONFIG_PATH} contains unknown keys: ${unknownKeys.join(', ')}.`);
}

for (const key of configKeys) {
  if (typeof config[key] !== 'string' || config[key].trim().length === 0) {
    throw new Error(`${CONFIG_PATH} must define a non-empty string for ${key}.`);
  }
}

if (!/^\d+\.\d+\.\d+$/.test(config.cudaToolkitVersion)) {
  throw new Error(`${CONFIG_PATH} cudaToolkitVersion must use major.minor.patch.`);
}
if (!/^\d+$/.test(config.ortCudaVersion)) {
  throw new Error(`${CONFIG_PATH} ortCudaVersion must be a numeric major version.`);
}

const nodeVersion = matchRequiredVersion('.mise.toml', mise, /^\s*node\s*=\s*"([^"]+)"\s*$/m);
const rustToolchain = matchRequiredVersion(
  'rust-toolchain.toml',
  rustToolchainToml,
  /^\s*channel\s*=\s*"([^"]+)"\s*$/m,
);
const resolved = { nodeVersion, rustToolchain, ...config };

const field = readFlagValue('--field');
const githubOutput = process.argv.includes('--github-output');

if (field !== null && githubOutput) {
  throw new Error('--field and --github-output are mutually exclusive.');
}

if (field !== null) {
  if (!Object.hasOwn(resolved, field)) {
    throw new Error(`Unknown release build config field: ${field}.`);
  }
  process.stdout.write(resolved[field]);
} else if (githubOutput) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error('GITHUB_OUTPUT is required with --github-output.');
  }
  const lines = Object.entries(OUTPUT_NAMES)
    .map(([key, outputName]) => `${outputName}=${resolved[key]}`)
    .join('\n');
  await appendFile(outputPath, `${lines}\n`);
} else {
  process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
}

function matchRequiredVersion(path, contents, pattern) {
  const match = contents.match(pattern);
  if (match === null) {
    throw new Error(`Could not resolve the version from ${path}.`);
  }
  return match[1];
}

function readFlagValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex < 0) {
    return null;
  }

  const value = process.argv[flagIndex + 1];
  if (value === undefined) {
    throw new Error(`${flagName} requires a value.`);
  }
  return value;
}
