export type Target = {
  mode: "toutiao" | "fanqie";
  root: string;
  work?: string;
  article?: string;
};
export type Focus = {
  article?: string;
  chapter?: string;
  candidate?: string;
  revision?: string | number;
  title?: string;
  workTitle?: string;
  source?: "chapter" | "candidate" | "article" | "split";
  dirty?: boolean;
  intent?: "write" | "review" | "plan" | "inspect" | "revise";
};

export const scopeId = (target?: Target | null) =>
  target ? JSON.stringify([target.mode, target.root, target.work || "", target.article || ""]) : "";
export const focusLabel = (target: Target, focus: Focus = {}) =>
  [
    focus.workTitle || target.work || (target.mode === "fanqie" ? "长篇项目" : "今日头条"),
    focus.title || focus.chapter || focus.article,
    focus.source === "candidate"
      ? "候选稿"
      : focus.source === "split"
        ? "正文与候选对照"
        : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

// Context travels with each queued prompt; browsing never changes a running task.
export function promptText(text: string, context: unknown) {
  return `<writer-context>\n${JSON.stringify(context)}\n</writer-context>\n\n${text}`;
}
export function promptContext(text: string) {
  const match = text.match(/^<writer-context>\n([^\n]+)\n<\/writer-context>\n\n/);
  return match
    ? { context: JSON.parse(match[1]), text: text.slice(match[0].length) }
    : { context: null, text };
}
export function toolLabel(name: string) {
  if (name === "writer_review") return "编辑审读";
  if (name === "writer_read_url") return "读取来源";
  if (/review|qa_check|lint|ledger_check/.test(name)) return "检查稿件与审读结果";
  if (/candidate.*accept/.test(name)) return "采纳候选稿";
  if (/candidate|draft_stage/.test(name)) return "准备与保存候选稿";
  if (/chapter_save|delivery_save|status/.test(name)) return "更新稿件状态";
  if (/method|forge_get|profile/.test(name)) return "查阅方法方案";
  if (/create|outline|foundation/.test(name)) return "整理作品与规划";
  return "读取创作材料";
}

export function toolStep(name: string, mode: "fanqie" | "toutiao") {
  if (mode === "toutiao") {
    if (/hot|feedback|ledger_show/.test(name)) return "立项";
    if (/article_create|card_/.test(name)) return "立项";
    if (/headline/.test(name)) return "立项";
    if (/draft_stage/.test(name)) return "成稿";
    if (/review|edit/.test(name)) return "红笔";
    if (/qa_check/.test(name)) return "质检";
    if (/delivery|ledger_add/.test(name)) return "交稿";
  }
  if (/review/.test(name)) return "送审";
  if (/candidate_.*stage|draft_stage/.test(name)) return "出候选";
  if (/lint|check|qa/.test(name)) return "自检";
  if (/outline|foundation|plan/.test(name)) return "规划";
  if (/candidate|chapter_save/.test(name)) return "起草";
  return "读材料";
}
