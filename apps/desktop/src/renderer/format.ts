export function humanVersion(value: unknown, at?: string) {
  return typeof value === "number"
    ? `第 ${value} 版${at ? " · " + at.slice(11, 16) : ""}`
    : at
      ? `已保存 · ${at.slice(11, 16)}`
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
