import os from "node:os";
import path from "node:path";

export const STATE_DIR_NAME = ".zhizhang";
export const WORKSPACE_META_DIR = ".zhizhang";
export const STATE_ROOT_ENV = "ZHIZHANG_STATE_ROOT";
export const FORMAT_VERSION = "zhizhang/1.3" as const;

export function resolveStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[STATE_ROOT_ENV]?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), STATE_DIR_NAME);
}

export function stateSubpath(sub: string, env?: NodeJS.ProcessEnv): string {
  return path.join(resolveStateRoot(env), sub);
}
