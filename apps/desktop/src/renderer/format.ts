import { formatDateTime } from "../../../../packages/ui/src/copy.js";

export function humanVersion(value: unknown, at?: string) {
  // 版本标签只带时刻（HH:mm），日期从 formatDateTime 的固定宽度输出里截取。
  return typeof value === "number"
    ? `第 ${value} 版${at ? " · " + formatDateTime(at).slice(11) : ""}`
    : at
      ? `已保存 · ${formatDateTime(at).slice(11)}`
      : "已保存版本";
}

export function actionTitle(text: string) {
  const raw = text.replace(/^【写作台】\s*/, "");
  let title = raw.split(/[。\n]/)[0] || raw;
  title = title.split("：")[0] || title;
  title = title
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, "")
    .replace(/[，,、；;\s]+$/g, "")
    .trim();
  return title.length > 44 ? title.slice(0, 44) + "…" : title;
}
