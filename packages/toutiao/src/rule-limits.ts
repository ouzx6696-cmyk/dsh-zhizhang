import { bridge } from "./env.js";
import { bridgeScript } from "./methods.js";
import type { ToutiaoConfig } from "./config.js";
interface RuleLimits {
  titleMax: number;
  drivers: string[];
  rulesVersion: string;
}
const loaded = new Map<string, Promise<RuleLimits>>();
export function loadLimits(config: ToutiaoConfig = {}): Promise<RuleLimits> {
  const key = JSON.stringify([config.python, bridgeScript()]);
  const existing = loaded.get(key);
  if (existing) return existing;
  const pending = bridge(config, ["limits"])
    .then((result) => {
      if (
        typeof result.title_max !== "number" ||
        !Number.isInteger(result.title_max) ||
        result.title_max < 1 ||
        typeof result.rules_version !== "string" ||
        !result.rules_version ||
        !Array.isArray(result.drivers) ||
        result.drivers.length === 0 ||
        result.drivers.some((value) => typeof value !== "string" || !value.trim())
      )
        throw new Error("规则脚本未返回有效的标题上限、驱动列表或版本");
      return {
        titleMax: result.title_max,
        rulesVersion: result.rules_version,
        drivers: result.drivers as string[],
      };
    })
    .catch((error) => {
      loaded.delete(key);
      throw error;
    });
  loaded.set(key, pending);
  return pending;
}
