export const COMMANDS = [
  {
    id: "新书",
    label: "创建新书",
    hint: "先创建作品，再做开书规划",
    icon: "book",
  },
  {
    id: "续写",
    label: "续写下一章／推进文章",
    hint: "按当前作品状态继续",
    icon: "pen",
  },
  {
    id: "改本章",
    label: "按审读回报修改",
    hint: "针对当前章节或文章出修订稿",
    icon: "edit",
  },
  {
    id: "派编辑",
    label: "派独立编辑审读",
    hint: "使用编辑角色的模型与新上下文",
    icon: "review",
  },
  {
    id: "拆书",
    label: "拆解原文或链接",
    hint: "分析指定材料，不自动入库",
    icon: "library",
  },
  {
    id: "质检",
    label: "检查当前稿件",
    hint: "运行已有检查工具",
    icon: "check",
  },
  {
    id: "交稿",
    label: "准备交稿",
    hint: "头条交稿单／长篇导出检查",
    icon: "delivery",
  },
  {
    id: "导出",
    label: "导出稿件",
    hint: "TXT、DOCX 或复制标题与正文",
    icon: "export",
  },
  {
    id: "新对话",
    label: "新对话，保留作品",
    hint: "旧对话仍可查阅，重新交接当前作品",
    icon: "chat",
  },
];
export function humanVersion(value: unknown, at?: string) {
  return typeof value === "number"
    ? `第 ${value} 版${at ? " · " + at.slice(11, 16) : ""}`
    : at
      ? `已保存 · ${at.slice(11, 16)}`
      : "已保存版本";
}
