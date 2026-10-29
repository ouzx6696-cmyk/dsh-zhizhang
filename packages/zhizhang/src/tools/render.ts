import { Scheduler, StyleLinterPort } from "../lib/ports/index.js";
import type { StoragePaths } from "../lib/types.js";
export function clip(text: string, max: any) {
    const t = (text ?? "").trim();
    if (!t)
        return "（空）";
    return t.length <= max ? t : `${t.slice(0, max)}…`;
}
/** Lean outline preserves necessary causal steps and character knowledge without full method packs. */
export function renderOutlineLean(o: any) {
    const lines = [
        `- 视角：${o.pov || "（空）"}`,
        `- 人物知识边界：${o.knowledge || "（未额外声明；核对实际前文）"}`,
        `- 关键经历：${o.synopsis || "（空）"}`,
        `- 推进节点与转向依据：${o.beats || "（空）"}`,
        `- 目标字数：${o.targetWords}`,
        `- 处境透镜：${o.situationLens || "（空）"}`,
        `- 冲突：${o.conflict || "（空）"}`,
        `- 锁定：${o.locks || "（空）"}`,
        `- 落点 ending（纲末兑付 · 写进场面）：${o.ending || "（空）"}`,
    ];
    if (o.stateLens?.trim())
        lines.push(`- 状态透镜：${o.stateLens.trim()}`);
    if (o.livedScene?.trim())
        lines.push(`- 亲历：${clip(o.livedScene, 120)}`);
    return lines.join("\n");
}
export function renderOutline(o: any) {
    const lines = [
        `- 视角：${o.pov || "（空）"}`,
        `- 目标字数：${o.targetWords}`,
        `- 处境透镜 situationLens：${o.situationLens || "（空）"}`,
        `- 亲历重心 livedScene：${o.livedScene || "（空）"}`,
        `- 状态透镜 stateLens：${o.stateLens || "（空）"}`,
        `- 锁定：${o.locks || "（空）"}`,
        `- 知情：${o.knowledge || "（空）"}`,
        `- 冲突：${o.conflict || "（空）"}`,
        `- 节拍：${o.beats || "（空）"}`,
        `- 落点：${o.ending || "（空）"}`,
        `- 概要：${o.synopsis || "（空）"}`,
    ];
    return lines.join("\n");
}
export function renderStatus(meta: any, dir: string, paths: StoragePaths) {
    const total = meta.chapters.reduce((s: string, c: any) => s + c.wordCount, 0);
    const finalN = meta.chapters.filter((c: any) => c.status === "final").length;
    const lines = [
        `# 织章作品：${meta.title}`,
        `- key：${meta.key}`,
        `- 目录：${dir}`,
        `- 类型：${meta.genre || "（未设）"}`,
        `- 节奏：${meta.pace || "（未指定）"}`,
        `- 更新：${meta.updatedAt}`,
        `- 章节：${meta.chapters.length}（定稿 ${finalN}），约 ${total} 字`,
        "",
        "## 根基（节选）",
        `- 锁定：${clip(meta.foundation.locks, 80)}`,
        `- 已发生：${clip(meta.foundation.happened, 80)}`,
        `- 未结伏笔：${clip(meta.foundation.threads, 80)}`,
        "",
        ...(paths
            ? [
                "",
                "## 存储根（排查用）",
                `- 存储：${paths.base}`,
                `- 作品：${paths.works}`,
                `- 拆书库：${paths.library}`,
            ]
            : []),
        "",
        "## 章节",
    ];
    for (const ch of [...meta.chapters].sort((a: any, b: any) => a.position - b.position)) {
        lines.push(`${ch.position}. [${ch.status}] ${ch.title}（${ch.id}，${ch.wordCount} 字）`);
    }
    if (Array.isArray(meta.revisionImpacts) && meta.revisionImpacts.length)
        lines.push("", "## 修订待核对", ...meta.revisionImpacts.map((v: any) => `- ${v.chapterId}${v.nextChapterId ? ` → ${v.nextChapterId}` : ""}：${v.reason}；相关后稿 ${(v.dependents ?? []).join("、") || "未记录明确依赖"}；历史 ${v.history}`));
    lines.push("", `下一步（默认）：${Scheduler.nextHint("work_status")}`);
    return lines.join("\n");
}
export function formatLint(label: string, hits: any, summary: any) {
    return StyleLinterPort.format(label, hits, summary);
}
