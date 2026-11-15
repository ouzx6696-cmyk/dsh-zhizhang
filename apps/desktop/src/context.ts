/** 渲染层共用的目标/关注点工具：作用域键、标题与工具显示名。 */
import type { Focus, Target } from "./shared/views.js";

export type { Focus, Target };

export const scopeId = (target?: Target | null) =>
  target ? JSON.stringify([target.mode, target.path, target.subId ?? ""]) : "";

export const focusLabel = (target: Target, focus: Focus = {}) =>
  [
    focus.workTitle || (target.mode === "fanqie" ? "长篇作品" : "今日头条"),
    focus.title || focus.chapter || focus.article,
    focus.source === "candidate" ? "候选稿" : focus.source === "split" ? "正文与候选对照" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

const TOOL_LABELS: Record<string, string> = {
  fanqie_list_chapters: "列出章节",
  fanqie_work_info: "读取作品信息",
  fanqie_read_chapter: "读取章节",
  fanqie_bible_view: "查阅故事圣经",
  fanqie_bible_audit: "巡检故事圣经",
  fanqie_list_candidates: "列出候选稿",
  fanqie_read_candidate: "读取候选稿",
  fanqie_read_method: "查阅方法",
  fanqie_start_chapter: "发起章节流水线",
  fanqie_start_review: "派编辑审读",
  fanqie_start_revise: "发起定向修订",
  fanqie_start_health: "发起全书体检",
  fanqie_open_compare: "打开对照",
  toutiao_article_status: "读取文章状态",
  toutiao_read_card: "读取立项卡",
  toutiao_read_draft: "读取草稿",
  toutiao_list_sources: "列出来源",
  toutiao_read_source: "读取来源",
  toutiao_read_ledger: "读取发稿台账",
  toutiao_read_feedback: "读取改稿反馈",
  toutiao_read_method: "查阅方法",
  toutiao_start_article: "发起文章流水线",
  toutiao_open_article: "打开文章视图",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? "读取创作材料";
}
