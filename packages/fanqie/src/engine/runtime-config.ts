import { AsyncLocalStorage } from "node:async_hooks";
import type { PluginConfig } from "./types.js";
const configurations = new AsyncLocalStorage<PluginConfig>();
const DEFAULT_CONFIG: PluginConfig = {};
export const config = new Proxy<PluginConfig>(
  {},
  {
    get: (_target, key: string) => (configurations.getStore() ?? DEFAULT_CONFIG)[key],
    ownKeys: () => Reflect.ownKeys(configurations.getStore() ?? DEFAULT_CONFIG),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);
export function withPluginConfig<T>(value: PluginConfig, run: () => T): T {
  return configurations.run(value, run);
}
