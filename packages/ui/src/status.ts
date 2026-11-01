export type StatusMode = "fanqie" | "toutiao";
export type StatusTone = "neutral" | "info" | "warn" | "success" | "danger";

const FANQIE: Record<string, { label: string; tone: StatusTone }> = {
  drafting: { label: "草稿", tone: "neutral" },
  draft: { label: "草稿", tone: "neutral" },
  drafted: { label: "草稿", tone: "neutral" },
  planned: { label: "待规划", tone: "neutral" },
  staged: { label: "待审", tone: "info" },
  reviewed: { label: "已审", tone: "success" },
  accepted: { label: "已审", tone: "success" },
  final: { label: "定稿", tone: "success" },
  live: { label: "已交稿", tone: "success" },
};

const TOUTIAO: Record<string, { label: string; tone: StatusTone }> = {
  初稿待改: { label: "待写", tone: "neutral" },
  待验收: { label: "待验收", tone: "info" },
  验收退回: { label: "待改", tone: "danger" },
  已验收: { label: "已验收", tone: "success" },
  已交稿: { label: "已交稿", tone: "success" },
};

export function statusInfo(mode: StatusMode, status?: string) {
  if (!status) return { label: mode === "toutiao" ? "待写" : "待规划", tone: "neutral" as StatusTone };
  const table = mode === "toutiao" ? TOUTIAO : FANQIE;
  if (table[status]) return table[status];
  if (/[\u4e00-\u9fa5]/.test(status)) return { label: status, tone: "neutral" as StatusTone };
  return { label: "状态未知", tone: "warn" as StatusTone };
}

export const statusLabel = (mode: StatusMode, status?: string) => statusInfo(mode, status).label;
export const statusTone = (mode: StatusMode, status?: string) => statusInfo(mode, status).tone;
