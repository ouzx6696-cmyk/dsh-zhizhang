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

/** writer-method 块：v2 交接里紧随 writer-context 的纯文本方法全文（不经 JSON 转义）。 */
type PromptMethodBlock = { id: string; hash: string; text: string };

// 块定位与属性解析分两条正则：属性按 name="value" 全量收进表，id/hash 任意顺序都能读到。
const METHOD_BLOCK = /^<writer-method\s+([^>]*)>([\s\S]*?)<\/writer-method>\n*/;
const METHOD_ATTR = /([a-zA-Z]+)="([^"]*)"/g;

// Context travels with each queued prompt; browsing never changes a running task.
export function promptText(text: string, context: unknown, methodBlocks?: string[]) {
  const blocks = methodBlocks?.length ? `${methodBlocks.join("\n")}\n\n` : "";
  return `<writer-context>\n${JSON.stringify(context)}\n</writer-context>\n\n${blocks}${text}`;
}
export function promptContext(text: string) {
  const match = text.match(/^<writer-context>\n([^\n]+)\n<\/writer-context>\n\n/);
  if (!match) return { context: null, text, methods: [] as PromptMethodBlock[] };
  let rest = text.slice(match[0].length);
  const methods: PromptMethodBlock[] = [];
  for (let block = rest.match(METHOD_BLOCK); block; block = rest.match(METHOD_BLOCK)) {
    const attrs: Record<string, string> = {};
    for (const [, name, value] of block[1].matchAll(METHOD_ATTR)) attrs[name] = value;
    methods.push({ id: attrs.id, hash: attrs.hash, text: block[2] });
    rest = rest.slice(block[0].length);
  }
  return { context: JSON.parse(match[1]), text: rest, methods };
}
export function toolLabel(name: string) {
  if (name === "writer_review") return "编辑审读";
  if (name === "writer_read_url") return "读取来源";
  if (/review|qa_check|lint|ledger_check/.test(name)) return "检查稿件与审读结果";
  if (/candidate.*accept/.test(name)) return "采纳候选稿";
  if (/candidate|draft_stage/.test(name)) return "准备与保存候选稿";
  if (/chapter_save|delivery_save|status/.test(name)) return "更新稿件状态";
  if (/method|profile/.test(name)) return "查阅方法方案";
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
