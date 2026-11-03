import { bridge } from "./env.js";
import { bridgeScript } from "./methods.js";
import type { ToutiaoConfig } from "./config.js";
interface RuleLimits {
  titleMax: number;
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
        !result.rules_version
      )
        throw new Error("规则脚本未返回有效的标题上限或版本");
      return { titleMax: result.title_max, rulesVersion: result.rules_version };
    })
    .catch((error) => {
      loaded.delete(key);
      throw error;
    });
  loaded.set(key, pending);
  return pending;
}
