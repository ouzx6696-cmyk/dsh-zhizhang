/** 番茄长篇模式的配置（writer-agent 配置的 fanqie 段）：数据位置、Python、定稿条件、门禁开关、多草稿。 */
import type { PluginConfig } from "./engine/types.js";

export interface FanqieConfig extends PluginConfig {
  /** 数据目录（相对会话 cwd），默认 .writer */
  rootDir?: string;
  /** 固定数据根（绝对路径）；也认 WRITER_NOVEL_ROOT */
  storageRoot?: string;
  /** 作品目录，默认 <数据根>/works；也认 WRITER_NOVEL_WORKS */
  worksRoot?: string;
  /** 共享拆书库，默认 <数据根>/library；也认 WRITER_NOVEL_LIBRARY */
  libraryRoot?: string;
  /** 本地书源目录；也认 WRITER_NOVEL_SOURCE_ROOT */
  sourceRoot?: string;
  /** Python 命令；不填用顶层 python */
  python?: string;
  /** true：定稿前当前正文必须有一份"通过"且版本匹配的编辑审读回报（对话与写作台都受约束） */
  requireEditorPass?: boolean;
  /** 关闭的非锁定门禁 id */
  disabledGates?: string[];
  /** 同章多草稿统一整理，默认关 */
  multiDraft?: { enabled?: boolean };
  /** 抽卡：writer_draw 一次性起草 n 版开头/章末/书名简介并由编辑子会话评估排序，默认关；
   * max 单批版数上限 4，缺省 3 */
  draw?: { enabled?: boolean; max?: number };
  /** 结构化连续性：伏笔线/知识边界/章末交接的登记与核验工具、简报投影与修订影响联动，默认关 */
  continuity?: { enabled?: boolean };
  /** handoff.v2：任务交接改用方法包决策表（按状态收集方法与附件），默认关 */
  handoff?: { v2?: boolean };
  /** 会话策略：perChapter 章级会话（写手跨章自动开新对话，前章材料由交接简报从文件带入），
   * proactiveCompact 主动压缩（写手任务结算空闲后上下文达窗口 75% 即整理），默认全关 */
  session?: { perChapter?: boolean; proactiveCompact?: boolean };
  /** 收窄写手默认工具集：去掉诊断旁路与拆书写入类工具并拒绝采纳旁路参数，默认关 */
  toolset?: { narrowed?: boolean };
  /** 常驻规则重排：创作定向在前、工程约束整段压后，默认关 */
  brief?: { creationFirst?: boolean };
  /** 固定使用的方法方案（默认 / 原版 / 用户方案名或 id）；不填则用写作台或工具选的当前方案 */
  profile?: string;
}

/**
 * toolset.narrowed=true 时写手默认集排除的工具：诊断旁路 7 个 + 拆书写入/stage 类 9 个。
 * 引擎（engineTools）与写作层（createFanqieTools）共用这份名单；fanqie_product_map
 * 与 library_list / library_search / library_card_get / library_combo_suggest 保留作导航。
 */
export const WRITER_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  // 诊断旁路（engine/ports/scheduler.ts 的 diagnose.audit / library_audit 旁路）
  "fanqie_payoff_audit",
  "fanqie_human_feel_audit",
  "fanqie_novel_sense_audit",
  "fanqie_style_lint",
  "fanqie_review_ledger",
  "fanqie_library_audit",
  "fanqie_opening_audit",
  // 拆书写入/stage（进拆书库的链路属规划用途）
  "fanqie_library_import",
  "fanqie_library_plan",
  "fanqie_library_dissect_brief",
  "fanqie_library_facts_stage",
  "fanqie_library_structure_stage",
  "fanqie_library_card_stage",
  "fanqie_library_card_accept",
  "fanqie_library_card_discard",
  "fanqie_library_report",
]);

type Issue = { message: string; path: (string | number)[] };

const STRINGS = [
  "rootDir",
  "storageRoot",
  "worksRoot",
  "libraryRoot",
  "sourceRoot",
  "python",
  "profile",
] as const;
const KNOWN = new Set<string>([
  ...STRINGS,
  "requireEditorPass",
  "disabledGates",
  "multiDraft",
  "draw",
  "continuity",
  "handoff",
  "session",
  "brief",
  "toolset",
]);

/** 校验并填默认值；未知字段报错，免得拼错的配置悄悄不生效 */
export function parseFanqieConfig(
  input: unknown,
  at: string[] = ["fanqie"],
): { value?: FanqieConfig; issues: Issue[] } {
  const issues: Issue[] = [];
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input))
    return { issues: [{ message: `${at.join(".")} 应为对象`, path: at }] };
  const v = input as Record<string, unknown>;
  const out: FanqieConfig = {};
  for (const k of Object.keys(v))
    if (!KNOWN.has(k))
      issues.push({ message: `${[...at, k].join(".")} 不是有效配置项`, path: [...at, k] });
  for (const k of STRINGS) {
    const x = v[k];
    if (x === undefined) continue;
    if (typeof x !== "string")
      issues.push({ message: `${[...at, k].join(".")} 应为字符串`, path: [...at, k] });
    else if (x.trim()) out[k] = x.trim();
  }
  if (v.requireEditorPass !== undefined) {
    if (typeof v.requireEditorPass !== "boolean")
      issues.push({
        message: `${[...at, "requireEditorPass"].join(".")} 应为布尔值`,
        path: [...at, "requireEditorPass"],
      });
    else out.requireEditorPass = v.requireEditorPass;
  }
  if (v.disabledGates !== undefined) {
    if (!(Array.isArray(v.disabledGates) && v.disabledGates.every((x) => typeof x === "string")))
      issues.push({
        message: `${[...at, "disabledGates"].join(".")} 应为字符串数组`,
        path: [...at, "disabledGates"],
      });
    else out.disabledGates = v.disabledGates as string[];
  }
  if (v.multiDraft !== undefined) {
    const m = v.multiDraft as Record<string, unknown> | null;
    if (
      !m ||
      typeof m !== "object" ||
      Array.isArray(m) ||
      (m.enabled !== undefined && typeof m.enabled !== "boolean")
    )
      issues.push({
        message: `${[...at, "multiDraft"].join(".")} 应为 { enabled: 布尔值 }`,
        path: [...at, "multiDraft"],
      });
    else out.multiDraft = { enabled: m.enabled === true };
  }
  if (v.draw !== undefined) {
    const d = v.draw as Record<string, unknown> | null;
    const max = d?.max;
    if (
      !d ||
      typeof d !== "object" ||
      Array.isArray(d) ||
      (d.enabled !== undefined && typeof d.enabled !== "boolean") ||
      (max !== undefined &&
        (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 4))
    )
      issues.push({
        message: `${[...at, "draw"].join(".")} 应为 { enabled: 布尔值, max: 1-4 的整数 }`,
        path: [...at, "draw"],
      });
    else
      out.draw = {
        enabled: d.enabled === true,
        ...(typeof max === "number" ? { max } : {}),
      };
  }
  if (v.continuity !== undefined) {
    const c = v.continuity as Record<string, unknown> | null;
    if (
      !c ||
      typeof c !== "object" ||
      Array.isArray(c) ||
      (c.enabled !== undefined && typeof c.enabled !== "boolean")
    )
      issues.push({
        message: `${[...at, "continuity"].join(".")} 应为 { enabled: 布尔值 }`,
        path: [...at, "continuity"],
      });
    else out.continuity = { enabled: c.enabled === true };
  }
  if (v.handoff !== undefined) {
    const h = v.handoff as Record<string, unknown> | null;
    if (
      !h ||
      typeof h !== "object" ||
      Array.isArray(h) ||
      (h.v2 !== undefined && typeof h.v2 !== "boolean")
    )
      issues.push({
        message: `${[...at, "handoff"].join(".")} 应为 { v2: 布尔值 }`,
        path: [...at, "handoff"],
      });
    else out.handoff = { v2: h.v2 === true };
  }
  if (v.session !== undefined) {
    const s = v.session as Record<string, unknown> | null;
    if (
      !s ||
      typeof s !== "object" ||
      Array.isArray(s) ||
      (s.perChapter !== undefined && typeof s.perChapter !== "boolean") ||
      (s.proactiveCompact !== undefined && typeof s.proactiveCompact !== "boolean")
    )
      issues.push({
        message: `${[...at, "session"].join(".")} 应为 { perChapter: 布尔值, proactiveCompact: 布尔值 }`,
        path: [...at, "session"],
      });
    else
      out.session = {
        perChapter: s.perChapter === true,
        proactiveCompact: s.proactiveCompact === true,
      };
  }
  if (v.brief !== undefined) {
    const b = v.brief as Record<string, unknown> | null;
    if (
      !b ||
      typeof b !== "object" ||
      Array.isArray(b) ||
      (b.creationFirst !== undefined && typeof b.creationFirst !== "boolean")
    )
      issues.push({
        message: `${[...at, "brief"].join(".")} 应为 { creationFirst: 布尔值 }`,
        path: [...at, "brief"],
      });
    else out.brief = { creationFirst: b.creationFirst === true };
  }
  if (v.toolset !== undefined) {
    const t = v.toolset as Record<string, unknown> | null;
    if (
      !t ||
      typeof t !== "object" ||
      Array.isArray(t) ||
      (t.narrowed !== undefined && typeof t.narrowed !== "boolean")
    )
      issues.push({
        message: `${[...at, "toolset"].join(".")} 应为 { narrowed: 布尔值 }`,
        path: [...at, "toolset"],
      });
    else out.toolset = { narrowed: t.narrowed === true };
  }
  out.rootDir ??= ".writer";
  return issues.length ? { issues } : { value: out, issues };
}
