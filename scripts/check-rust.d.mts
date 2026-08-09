export interface RustQualityCommand {
  args: string[];
  command: 'cargo';
  env: NodeJS.ProcessEnv;
}

export function buildRustQualityCommands(environment?: NodeJS.ProcessEnv): RustQualityCommand[];
