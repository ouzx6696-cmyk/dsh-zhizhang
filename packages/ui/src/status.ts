export type StatusMode = "fanqie" | "toutiao";
type StatusTone = "neutral" | "info" | "warning" | "success" | "danger";

const FANQIE: Record<string, { label: string; tone: StatusTone; dot: string }> = {
  drafting: { label: "草稿", tone: "neutral", dot: "warning" },
  draft: { label: "草稿", tone: "neutral", dot: "warning" },
  drafted: { label: "草稿", tone: "neutral", dot: "warning" },
  planned: { label: "待规划", tone: "neutral", dot: "idle" },
  staged: { label: "待审", tone: "info", dot: "warning" },
  reviewed: { label: "已审", tone: "success", dot: "done" },
  accepted: { label: "已审", tone: "success", dot: "done" },
  final: { label: "定稿", tone: "success", dot: "done" },
  live: { label: "已交稿", tone: "success", dot: "done" },
};

/** 业务状态词；界面判断“已交稿”时用这个常量，不读展示文案。 */
export const TOUTIAO_DELIVERED = "已交稿";

const TOUTIAO: Record<string, { label: string; tone: StatusTone; dot: string }> = {
  初稿待改: { label: "初稿待改", tone: "neutral", dot: "warning" },
  待验收: { label: "待验收", tone: "info", dot: "warning" },
  验收退回: { label: "验收退回", tone: "danger", dot: "error" },
  已验收: { label: "已验收", tone: "success", dot: "done" },
  [TOUTIAO_DELIVERED]: { label: TOUTIAO_DELIVERED, tone: "success", dot: "done" },
};

export function statusInfo(mode: StatusMode, status?: string) {
  if (!status)
    return {
      label: mode === "toutiao" ? "待写" : "待规划",
      tone: "neutral" as StatusTone,
      dot: "idle",
    };
  const table = mode === "toutiao" ? TOUTIAO : FANQIE;
  if (table[status]) return table[status];
  if (/[\u4e00-\u9fa5]/.test(status))
    return { label: status, tone: "neutral" as StatusTone, dot: "idle" };
  return { label: "状态未知", tone: "warning" as StatusTone, dot: "warning" };
}

export const statusLabel = (mode: StatusMode, status?: string) => statusInfo(mode, status).label;
export const statusTone = (mode: StatusMode, status?: string) => statusInfo(mode, status).tone;

export const ARTICLE_STEPS = ["立项", "成稿", "红笔", "质检", "交稿"];
export function articleProgress(
  article?: {
    status?: string;
    draft?: unknown;
    rev?: number;
    qa?: { pass?: boolean; rev?: number }[];
    card?: { present?: boolean };
  } | null,
) {
  if (!article) return 0;
  if (article.status === "已交稿") return 5;
  if (article.status === "已验收") return 4;
  if (article.status === "待验收") return 3;
  if (article.status === "验收退回") return 2;
  return article.draft || article.rev ? 2 : article.card?.present ? 1 : 0;
}
