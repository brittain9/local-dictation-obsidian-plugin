// Read a required environment variable, throwing a clear error when it is unset
// or empty. Shared by the release packaging and timing-report scripts so the
// "missing env" failure mode stays identical across them.

export function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return value;
}
