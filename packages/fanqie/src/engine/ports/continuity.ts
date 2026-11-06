/** Continuity switch (T10, default off): reads the port config set by bootstrap. */
import { getPortConfig } from "./config.js";
import { NovelError } from "../errors.js";
export function isContinuityEnabled() {
  return getPortConfig().continuity.enabled;
}
/** 工具内复核：关闭时明确报错，而不是静默当空数据处理。 */
export function requireContinuityEnabled() {
  if (isContinuityEnabled()) return;
  throw new NovelError(
    "continuity_disabled",
    "连续性未开启（continuity_disabled）：在配置 fanqie.continuity.enabled=true 后可用，默认关。",
  );
}
