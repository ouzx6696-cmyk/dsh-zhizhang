import { writeLedgerEntry, readLedger } from "../../storage/ledger.js";

import { findChapter } from "../../storage/chapters.js";

import { REVIEW_EVIDENCE_KINDS } from "../../types.js";
import { asString, fail, openWork } from "../context.js";

import { B, E, S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const reviewLedger = defineTool({
  name: "fanqie_review_ledger",
  description:
    "审校留痕：action=get 列出操作记录；action=append 写入作者四维勾选或 AI 诊断笔记（五类证据范畴仅作分类，本工具不生成正文）；action=evidence_kinds 列出五类范畴名。工程文件仍为 ledger.json。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    action: E(["get", "append", "evidence_kinds"], "操作"),
    chapter: S("append 时必填：章节 id"),
    kind: E(
      [
        "style_lint",
        "author_checks",
        "ai_review_notes",
        "finalize",
        "note",
        "chapter_save_direct",
        "brief_seen",
        "payoff_audit",
      ],
      "条目类型",
    ),
    summary: S("摘要"),
    dim_locks_ledger: B("四维：锁定/伏笔"),
    dim_pov_situation: B("四维：视角处境"),
    dim_style_radar: B("四维：语感雷达已阅"),
    dim_continuity_snap: B("四维：衔接快照已阅"),
    issues_json: S(
      "可选：JSON 数组 [{category,finding,evidence,suggestion}]，category 建议用五类证据名",
    ),
  },
  required: ["action"],
  async execute(args, exec) {
    const action = asString(args, "action", { required: true });
    if (action === "evidence_kinds") {
      return [
        "审校五类证据范畴（供 Agent 诊断分类，非生成许可）：",
        ...REVIEW_EVIDENCE_KINDS.map((k, i: number) => `${i + 1}. ${k}`),
      ].join("\n");
    }
    const { dir } = await openWork(exec, args);
    if (action === "get") {
      const ledger = await readLedger(dir);
      if (ledger.entries.length === 0) return "审校留痕为空。";
      return ledger.entries
        .map(
          (e, i: number) =>
            `${i + 1}. [${e.at}] ${e.kind} · ${e.chapterId} · ${e.summary}${e.styleHitCount != null ? ` · lint=${e.styleHitCount}` : ""}`,
        )
        .join("\n");
    }
    if (action !== "append") fail("action 必须是 get / append / evidence_kinds");
    const chapterId = asString(args, "chapter", { required: true });
    const kind = asString(args, "kind") ?? "note";
    const summary = asString(args, "summary", { required: true });
    // 留痕指向真实章节：对不存在的章记「定稿」会让 ledger 与小说状态脱钩。
    // 只有文件缺失才算「章节不存在」；front matter 损坏由 findChapter 原样抛出，避免作者以为该章从未建立。
    if (!(await findChapter(dir, chapterId)))
      fail(`章节 ${chapterId} 不存在，审校留痕必须指向真实章节`, "not_found");
    const dims: Record<string, boolean> = {};
    if (typeof args.dim_locks_ledger === "boolean") dims.locks_ledger = args.dim_locks_ledger;
    if (typeof args.dim_pov_situation === "boolean") dims.pov_situation = args.dim_pov_situation;
    if (typeof args.dim_style_radar === "boolean") dims.style_radar = args.dim_style_radar;
    if (typeof args.dim_continuity_snap === "boolean")
      dims.continuity_snap = args.dim_continuity_snap;
    let issues;
    if (typeof args.issues_json === "string" && args.issues_json.trim()) {
      try {
        issues = JSON.parse(args.issues_json);
      } catch {
        fail("issues_json 不是合法 JSON");
      }
    }
    const entry = await writeLedgerEntry(dir, { chapterId, kind, summary, dims, issues });
    return `已记入审校留痕 ${entry.id}：${entry.summary}`;
  },
});
