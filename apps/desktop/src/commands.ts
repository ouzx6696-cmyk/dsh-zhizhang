export const COMMANDS = [
  {
    id: "新书",
    label: "创建新书",
    hint: "先创建作品，再做开书规划",
  },
  {
    id: "续写",
    label: "续写下一章／推进文章",
    hint: "按当前作品状态继续",
  },
  {
    id: "改本章",
    label: "按审读回报修改",
    hint: "针对当前章节或文章出修订稿",
  },
  {
    id: "派编辑",
    label: "派独立编辑审读",
    hint: "使用编辑角色的模型与新上下文",
  },
  {
    id: "拆书",
    label: "拆解原文或链接",
    hint: "分析指定材料，不自动入库",
  },
  {
    id: "质检",
    label: "检查当前稿件",
    hint: "运行已有检查工具",
  },
  {
    id: "交稿",
    label: "准备交稿",
    hint: "头条交稿单／长篇导出检查",
  },
  {
    id: "导出",
    label: "导出稿件",
    hint: "TXT、DOCX 或复制标题与正文",
  },
  {
    id: "新对话",
    label: "新对话，保留作品",
    hint: "旧对话仍可查阅，重新交接当前作品",
  },
];
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
