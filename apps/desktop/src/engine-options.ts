import { parseFanqieConfig } from "../../../packages/fanqie/src/config";
import { parseToutiaoConfig } from "../../../packages/toutiao/src/config";
import { isRecord } from "../../../packages/core/src/parse";
import type { SessionOptions } from "./session/types";
export function parseWriterOptions(value: unknown): SessionOptions {
  if (!isRecord(value) || Object.keys(value).some((key) => !["fanqie", "toutiao"].includes(key)))
    throw new Error("写作功能设置须包含长篇与头条配置");
  const fanqie = parseFanqieConfig(value.fanqie),
    toutiao = parseToutiaoConfig(value.toutiao);
  if (fanqie.issues.length || toutiao.issues.length || !fanqie.value || !toutiao.value)
    throw new Error([...fanqie.issues, ...toutiao.issues].map((issue) => issue.message).join("；"));
  return { fanqie: fanqie.value, toutiao: toutiao.value };
}
