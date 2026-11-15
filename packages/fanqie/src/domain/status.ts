import { AppError } from "@zhizhang/core/errors";

export const CHAPTER_STATUSES = ["planned", "drafting", "drafted", "reviewed", "final"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  planned: "待规划",
  drafting: "草稿",
  drafted: "草稿",
  reviewed: "已审",
  final: "定稿",
};

export const MAX_EDITOR_REJECTIONS = 2;

export function assertCanFinalize(opts: {
  status: ChapterStatus;
  requireEditorPass: boolean;
  editorPass?: boolean;
  editorRejections?: number;
}): void {
  if (opts.status !== "reviewed") {
    throw new AppError("gate.denied", "章节需先完成审读并处于已审状态才能定稿", {
      status: opts.status,
    });
  }
  if (opts.requireEditorPass && !opts.editorPass) {
    throw new AppError("gate.denied", "当前作品要求编辑通过后才能定稿");
  }
  if ((opts.editorRejections ?? 0) > MAX_EDITOR_REJECTIONS) {
    throw new AppError("gate.denied", "编辑打回已达两轮上限，请由作者直接裁决");
  }
}

export function downgradeOnEdit(status: ChapterStatus): ChapterStatus {
  return status === "reviewed" || status === "final" ? "drafted" : status;
}
