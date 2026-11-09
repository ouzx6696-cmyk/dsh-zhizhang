import { loadLimits } from "./rule-limits.js";
import { PLANNER_TOOLS } from "../../core/src/tool-roles.js";
/** 头条工具集。全部返回结构化 JSON；业务失败返回 ok:false。 */
import { appendFile } from "node:fs/promises";
import {
  defineWriterTool,
  WriterError,
  type ToolDefinition,
  type ToolExecution,
  type JsonSchemaNode,
} from "../../core/src/tool.js";
import { atomicWrite, readJson, readText, serialize, sha256 } from "../../core/src/fsx.js";
import type { GateEngine } from "../../core/src/gates.js";
import { checkCard, titleLength } from "./card.js";
import { bridge, storeFor, type ToutiaoConfig } from "./env.js";
import { METHOD_FILES, toutiaoLibrary } from "./methods.js";
import { activeProfile, profileDetail, readMethod } from "../../core/src/profiles.js";
import { createProfileTool } from "../../core/src/profile-tool.js";
import { getUserAsset, listUserAssets, USER_PREFIX } from "../../core/src/user-assets.js";
import {
  canTransition,
  MAX_RETURN_ROUNDS,
  nowIso,
  parseFeedbackEntries,
  formatFeedbackLine,
  STATUSES,
  STOP_LINE,
  today,
  type ArticleMeta,
  type FeedbackEntry,
  type QaDims,
  type Status,
} from "./store.js";

const S = (description: string): JsonSchemaNode => ({ type: "string", description });
const I = (description: string): JsonSchemaNode => ({ type: "integer", description });
const B = (description: string): JsonSchemaNode => ({ type: "boolean", description });
const E = (values: readonly string[], description: string): JsonSchemaNode => ({
  type: "string",
  enum: [...values],
  description,
});
const ID = S("文章 id（YYYY-MM-DD-slug，toutiao_article_create 返回）");

function reqStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new WriterError("INVALID_ARGS", `参数 ${key} 必填`);
  return v.trim();
}
/** 脚本输出是信任边界：字段缺省视为空，类型不符即判脚本失败，不让坏数据混进回执。 */
function scriptArray(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new WriterError("SCRIPT_FAILED", `质检脚本输出异常：${label} 应为数组`);
  return value;
}
function scriptStrArray(value: unknown, label: string): string[] {
  const out: string[] = [];
  for (const item of scriptArray(value, label)) {
    if (typeof item !== "string")
      throw new WriterError("SCRIPT_FAILED", `质检脚本输出异常：${label} 含非字符串项`);
    out.push(item);
  }
  return out;
}
function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new WriterError("INVALID_ARGS", `参数 ${key} 必须是字符串`);
  return v.trim();
}

const QA_DIM_KEYS = ["ai", "read", "title", "detail", "structure", "compliance"] as const;

/** 六维分项从质检报告 items 提取；脚本没给出全部六项时不存（旧记录本就没有 dims）。 */
function dimsOf(report: { items?: unknown[] } | undefined): QaDims | undefined {
  const scores = new Map<string, number>();
  for (const item of report?.items ?? []) {
    if (!item || typeof item !== "object") continue;
    const row = item as { key?: unknown; score?: unknown };
    if (typeof row.key === "string" && typeof row.score === "number")
      scores.set(row.key, row.score);
  }
  const dims: QaDims = { ai: 0, read: 0, title: 0, detail: 0, structure: 0, compliance: 0 };
  for (const key of QA_DIM_KEYS) {
    const value = scores.get(key);
    if (value === undefined) return undefined;
    dims[key] = value;
  }
  return dims;
}

/* ---- toutiao_metrics_import 的两种入参（对象数组 / CSV 文本）都归一到台账列名 ---- */

/** 台账指标列（与 rules.py LEDGER_METRIC_FIELDS 对应；链接/数据日期由桥侧维护）。 */
const METRIC_KEY_MAP = {
  impressions: "展现",
  reads: "阅读",
  readRate: "完读率",
  avgReadSeconds: "平均时长",
  comments: "评论",
  shares: "转发",
  follows: "涨粉",
} as const;
const METRIC_CSV_HEADERS: Record<string, string> = {
  日期: "date",
  date: "date",
  展现: "impressions",
  impressions: "impressions",
  阅读: "reads",
  reads: "reads",
  完读率: "readRate",
  readrate: "readRate",
  平均时长: "avgReadSeconds",
  avgreadseconds: "avgReadSeconds",
  评论: "comments",
  comments: "comments",
  转发: "shares",
  shares: "shares",
  涨粉: "follows",
  follows: "follows",
};
const METRIC_MAX_ROWS = 60;

function normalizeMetricRows(rows: Record<string, unknown>[]): Record<string, string>[] {
  if (rows.length === 0) throw new WriterError("INVALID_ARGS", "metrics 须为非空数组");
  if (rows.length > METRIC_MAX_ROWS)
    throw new WriterError(
      "INVALID_ARGS",
      `metrics 一次最多 ${METRIC_MAX_ROWS} 行，历史数据请分批导入`,
    );
  return rows.map((row) => {
    const date = row["date"];
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim()))
      throw new WriterError("INVALID_ARGS", "metrics 每行都要有 date（YYYY-MM-DD）");
    const out: Record<string, string> = { 日期: date.trim() };
    let anyValue = false;
    for (const [key, label] of Object.entries(METRIC_KEY_MAP)) {
      const value = row[key];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "number" && typeof value !== "string")
        throw new WriterError("INVALID_ARGS", `metrics.${key} 须为数字或原文文本`);
      const text = typeof value === "number" ? String(value) : value.trim();
      if (!text) continue;
      out[label] = text;
      anyValue = true;
    }
    if (!anyValue) throw new WriterError("INVALID_ARGS", `${out["日期"]} 这一行没有任何指标值`);
    return out;
  });
}

function metricObjects(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) throw new WriterError("INVALID_ARGS", "metrics 须为数组");
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new WriterError("INVALID_ARGS", "metrics 每行须为对象");
    return item as Record<string, unknown>;
  });
}

/** 粘贴 CSV 的最小解析：双引号可包住逗号/换行，两个引号转义一个引号。 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (started) rows.push(row);
    row = [];
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      started = true;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      endField();
      started = true;
    } else if (ch === "\n") endRow();
    else if (ch !== "\r") {
      field += ch;
      started = true;
    }
  }
  if (inQuotes) throw new WriterError("INVALID_ARGS", "CSV 引号没有闭合");
  endRow();
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

function csvMetricRows(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new WriterError("INVALID_ARGS", "CSV 至少要有表头和一行数据");
  const headers = rows[0].map((cell) => {
    const mapped = METRIC_CSV_HEADERS[cell.trim().toLowerCase()];
    if (!mapped)
      throw new WriterError(
        "INVALID_ARGS",
        `CSV 表头不认识“${cell.trim()}”：应为 日期,展现,阅读,完读率,平均时长,评论,转发,涨粉`,
      );
    return mapped;
  });
  return normalizeMetricRows(
    rows.slice(1).map((cells) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((key, i) => {
        const cell = cells[i];
        if (cell !== undefined && cell.trim()) obj[key] = cell.trim();
      });
      return obj;
    }),
  );
}

interface ToolDeps {
  config: ToutiaoConfig;
  /** 门禁引擎（工具内复核作者确认用） */
  gates: () => GateEngine | undefined;
  /** 本会话角色：writer 主写手（默认）/ editor 编辑子代理 */
  role?: Role;
}

type Role = "writer" | "editor" | "planner";

/** 编辑角色可见的工具：只能读稿、改稿（记为 editor 版）、记红笔、跑质检；不能改状态、出交稿单、记台账 */
const EDITOR_TOOLS = new Set([
  "toutiao_method_get",
  "toutiao_rules",
  "toutiao_article_list",
  "toutiao_article_get",
  "toutiao_draft_get",
  "toutiao_draft_stage",
  "toutiao_edit_record",
  "toutiao_qa_check",
  "toutiao_feedback_read",
]);

function summary(m: ArticleMeta) {
  const cur = m.drafts.find((d) => d.rev === m.current_rev);
  const lastQa = m.qa[m.qa.length - 1];
  return {
    id: m.id,
    status: m.status,
    line: m.line,
    genre: m.genre,
    current_rev: m.current_rev,
    chars: cur?.chars ?? 0,
    headline: m.headlines.main || m.title_hint,
    return_rounds: m.return_rounds,
    last_qa: lastQa ? { rev: lastQa.rev, score: lastQa.score, pass: lastQa.pass } : null,
    delivered: m.delivered,
    updated_at: m.updated_at,
  };
}

/** 当前版本是否有仍然有效（稿件与立项卡都未改）的过线质检 */
export async function validPassingQa(store: Awaited<ReturnType<typeof storeFor>>, m: ArticleMeta) {
  const q = store.latestQaFor(m);
  if (!q) return { ok: false as const, reason: "当前版本还没跑质检（toutiao_qa_check）" };
  try {
    await store.readDraft(m.id, m.current_rev);
  } catch (error) {
    if (!(error instanceof WriterError) || error.code !== "NOT_FOUND") throw error;
    return { ok: false as const, reason: "稿件文件缺失，请保留现有文件并核对。" };
  }
  const cardSha = await store.cardSha(m.id);
  if (q.card_sha256 !== cardSha)
    return { ok: false as const, reason: "立项卡在质检后改过，请重跑 toutiao_qa_check" };
  if (!q.pass)
    return {
      ok: false as const,
      reason: `当前版本质检未过线（${q.score} 分${q.hard_gates.length ? "，硬闸：" + q.hard_gates.join("、") : ""}）`,
    };
  return { ok: true as const, qa: q };
}

export async function createToutiaoTools(deps: ToolDeps): Promise<ToolDefinition[]> {
  const { config } = deps;
  const { titleMax: TITLE_MAX, drivers } = await loadLimits(config);
  const st = (exec: ToolExecution) => storeFor(config, exec);

  return [
    defineWriterTool<{ id: string }>({
      name: "toutiao_method_get",
      description:
        "按步骤取头条写作方法或语料（Skill 第二、三级），按当前方法方案读取（默认 / 原版 / 用户方案，见 toutiao_profile）。开每一步前先取对应方法。id=list 列出当前方案的全部方法与作者自备的 user:… 资产；原版:id 强制读原件。作者自备资产只作参考，与质检规则冲突时以规则为准。",
      properties: {
        id: S(
          `方法或语料 id：${Object.keys(METHOD_FILES).join("、")}；或 list；或 user:相对路径（作者自备）`,
        ),
      },
      required: ["id"],
      async run(args, exec) {
        const id = reqStr(args, "id");
        const cwd = exec.cwd;
        if (id === "list") {
          const act = await activeProfile("toutiao", config.profile);
          const [detail, user] = await Promise.all([
            profileDetail(toutiaoLibrary, act.id, config.profile),
            listUserAssets(config.assets, cwd),
          ]);
          return {
            profile: act.name,
            profile_id: act.id,
            builtin: detail.methods.map((m) => m.id),
            methods: detail.methods.map((m) => ({ id: m.id, title: m.title, from: m.from })),
            user: user.assets.map((a) => ({
              id: a.id,
              file: `${a.dir}/${a.file}`,
              bytes: a.bytes,
            })),
            warnings: user.warnings,
          };
        }
        if (id.startsWith(USER_PREFIX))
          return { ...(await getUserAsset(config.assets, cwd, id)), source: "user" };
        return { ...(await readMethod(toutiaoLibrary, undefined, id, config.profile)) };
      },
    }),

    defineWriterTool({
      name: "toutiao_rules",
      description: "打印现行质检规则（规则唯一来源 rules.py 生成）。只在需要解释分数或规则时调用。",
      properties: {},
      async run(_a, exec) {
        const r = await bridge(config, ["rules"], { signal: exec.signal });
        return { rules_version: r.rules_version, markdown: r.markdown };
      },
    }),

    defineWriterTool<{ top?: number; vertical?: string; relevant?: boolean }>({
      name: "toutiao_hot_fetch",
      description: "S1 抓热榜。失败时返回 ok:false，请改用网页搜索，再不行请作者粘贴热榜。",
      properties: {
        top: I("条数，默认 30"),
        vertical: S("垂类，默认 综合"),
        relevant: B("只保留命中 12 垂类的条目"),
      },
      async run(args, exec) {
        const a = [
          "hot",
          "--top",
          String(Math.max(1, Math.min(100, Number(args.top ?? 30) || 30))),
          "--vertical",
          String(args.vertical ?? "综合"),
        ];
        if (args.relevant) a.push("--relevant");
        const r = await bridge(config, a, { timeoutMs: 120_000, signal: exec.signal });
        return { items: r.items };
      },
    }),

    defineWriterTool<Record<string, unknown>>({
      name: "toutiao_article_create",
      description:
        "S2 立项：新建一篇文章（状态 初稿待改），返回 id。之后用 toutiao_card_set 写立项卡。",
      properties: {
        slug: S("简短标识，字母数字中文 - _，如 rent-gjj 或 精卫"),
        date: S("YYYY-MM-DD，默认今天"),
        title_hint: S("题目方向一句话"),
        line: E(["资讯线", "故事线"], "内容线"),
        genre: E(["长图文", "短图文", "微头条"], "体裁"),
      },
      required: ["slug"],
      async run(args, exec) {
        const store = await st(exec);
        const m = await store.create(reqStr(args, "slug"), {
          date: optStr(args, "date"),
          titleHint: optStr(args, "title_hint"),
          line: optStr(args, "line"),
          genre: optStr(args, "genre"),
        });
        return { article: summary(m), root: store.root };
      },
    }),

    defineWriterTool<{ status?: string }>({
      name: "toutiao_article_list",
      description: "列出本工作区的头条文章（可按状态筛）。",
      properties: { status: E(STATUSES, "只看某个状态") },
      async run(args, exec) {
        const store = await st(exec);
        const all = await store.list();
        const rows = all.filter((m) => !args.status || m.status === args.status).map(summary);
        return { root: store.root, count: rows.length, articles: rows };
      },
    }),

    defineWriterTool<{ id: string; include_draft?: boolean }>({
      name: "toutiao_article_get",
      description:
        "读一篇文章：状态、立项卡、标题、质检记录；include_draft=true 时附当前稿件全文。",
      properties: { id: ID, include_draft: B("是否附当前稿件全文") },
      required: ["id"],
      async run(args, exec) {
        const store = await st(exec);
        const m = await store.get(reqStr(args, "id"));
        const card = await store.readCard(m.id);
        const out: Record<string, unknown> = {
          article: summary(m),
          headlines: m.headlines,
          qa: m.qa.slice(-3),
          history: m.history.slice(-8),
          card: card ?? null,
        };
        if (args.include_draft) {
          out.draft = m.current_rev > 0 ? await store.readDraft(m.id, m.current_rev) : "";
          out.basis = { rev: m.current_rev, sha256: store.currentDraft(m)?.sha256 || "" };
        }
        return out;
      },
    }),

    defineWriterTool<{ id: string; card: Record<string, unknown> }>({
      name: "toutiao_card_set",
      description:
        "S2 写入完整立项卡（字段同模板 template-card）。会做结构预检并返回问题清单；有 fail 也会保存，改好再写。",
      properties: { id: ID, card: { type: "object", description: "完整立项卡 JSON 对象" } },
      required: ["id", "card"],
      async run(args, exec) {
        const id = reqStr(args, "id");
        const card = args.card;
        if (!card || typeof card !== "object" || Array.isArray(card))
          throw new WriterError("INVALID_ARGS", "card 必须是对象");
        return await saveCard(await st(exec), id, card, TITLE_MAX, drivers);
      },
    }),

    defineWriterTool<{ id: string; patch: Record<string, unknown> }>({
      name: "toutiao_card_patch",
      description: "按顶层字段修改立项卡（浅合并；值为 null 删除该字段）。",
      properties: { id: ID, patch: { type: "object", description: "要改的顶层字段" } },
      required: ["id", "patch"],
      async run(args, exec) {
        const id = reqStr(args, "id");
        const store = await st(exec);
        return await serialize(store.cardPath(id), async () => {
          const cur = (await store.readCard(id)) ?? {};
          if (!args.patch || typeof args.patch !== "object" || Array.isArray(args.patch))
            throw new WriterError("INVALID_ARGS", "patch 必须是对象");
          const next: Record<string, unknown> = { ...cur };
          for (const [k, v] of Object.entries(args.patch)) {
            if (v === null) delete next[k];
            else next[k] = v;
          }
          return await saveCard(store, id, next, TITLE_MAX, drivers);
        });
      },
    }),
    defineWriterTool<{ id: string; main: string; alts?: string[] }>({
      name: "toutiao_headline_set",
      description: `S3 定标题：1 主 4 备，每条不超过 ${TITLE_MAX} 字；同时回填立项卡 主标题 / 备选标题。`,
      properties: {
        id: ID,
        main: S("主推标题"),
        alts: { type: "array", items: { type: "string" }, description: "备选标题（4 条）" },
      },
      required: ["id", "main"],
      async run(args, exec) {
        const id = reqStr(args, "id");
        const main = reqStr(args, "main");
        const alts = (Array.isArray(args.alts) ? args.alts : [])
          .map((x) => String(x).trim())
          .filter(Boolean);
        const over = [main, ...alts].filter((t) => titleLength(t) > TITLE_MAX);
        if (over.length)
          throw new WriterError(
            "INVALID_ARGS",
            `超过 ${TITLE_MAX} 字硬上限：${over.map((t) => `${t}（${titleLength(t)}字）`).join("；")}`,
          );
        const store = await st(exec);
        await store.update(id, (m) => {
          m.headlines = { main, alts };
        });
        const saved = await serialize(store.cardPath(id), async () => {
          const card = (await store.readCard(id)) ?? {};
          return saveCard(store, id, { ...card, 主标题: main, 备选标题: alts }, TITLE_MAX, drivers);
        });
        return {
          headlines: { main, alts },
          lengths: [main, ...alts].map((t) => titleLength(t)),
          card_issues: saved.issues,
          warnings: alts.length !== 4 ? ["标题矩阵应为 1 主 4 备"] : [],
        };
      },
    }),

    defineWriterTool<{
      id: string;
      text: string;
      role?: string;
      note?: string;
      expected_rev?: number;
      expected_sha256?: string;
    }>({
      name: "toutiao_draft_stage",
      description:
        "S4/S5 存一版稿件（只增不改，旧版保留）。新稿使状态回到 初稿待改，旧质检作废。text 为完整 Markdown，以 # 主标题 开头。",
      properties:
        deps.role === "editor"
          ? {
              id: ID,
              text: S("完整稿件 Markdown"),
              note: S("这一版改了什么"),
              expected_rev: I("依据版本"),
              expected_sha256: S("依据稿件哈希"),
            }
          : {
              id: ID,
              text: S("完整稿件 Markdown"),
              role: E(["writer", "author"], "writer=你写的；author=作者亲手改的版本"),
              note: S("这一版改了什么"),
              expected_rev: I("依据版本"),
              expected_sha256: S("依据稿件哈希"),
            },
      required: ["id", "text"],
      async run(args, exec) {
        const text = typeof args.text === "string" ? args.text : "";
        if (!text.trim()) throw new WriterError("INVALID_ARGS", "text 不能为空");
        // 角色由挂载决定，不信任参数：主写手不能把自己的稿子记成编辑版
        const role =
          deps.role === "editor" ? "editor" : args.role === "author" ? "author" : "writer";
        const m = await (
          await st(exec)
        ).stageDraft(
          reqStr(args, "id"),
          text.replace(/\r\n/g, "\n"),
          role,
          optStr(args, "note") ?? "",
          args.expected_rev === undefined
            ? undefined
            : { rev: args.expected_rev, sha256: args.expected_sha256 || "" },
        );
        return { article: summary(m), rev: m.current_rev };
      },
    }),

    defineWriterTool<{ id: string; rev?: number }>({
      name: "toutiao_draft_get",
      description: "读某一版稿件全文（默认当前版）。",
      properties: { id: ID, rev: I("版本号，默认当前版") },
      required: ["id"],
      async run(args, exec) {
        const store = await st(exec);
        const m = await store.get(reqStr(args, "id"));
        const rev = Number(args.rev ?? m.current_rev);
        if (!rev) throw new WriterError("NOT_FOUND", "还没有稿件");
        return {
          rev,
          text: await store.readDraft(m.id, rev),
          record: m.drafts.find((d) => d.rev === rev) ?? null,
        };
      },
    }),

    defineWriterTool<{ id: string; rows: { 原句: string; 改后: string; 病型: string }[] }>({
      name: "toutiao_edit_record",
      description:
        "S5 记录红笔三联改写留痕（病灶原句 → 改后 → 病型/为什么），累加保存，交稿单第八节用。",
      properties: {
        id: ID,
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { 原句: S("病灶原句"), 改后: S("改后句子"), 病型: S("病型编号与原因") },
            required: ["原句", "改后", "病型"],
            additionalProperties: false,
          },
          description: "三联表行",
        },
      },
      required: ["id", "rows"],
      async run(args, exec) {
        const store = await st(exec);
        const id = reqStr(args, "id");
        const m = await store.get(id);
        if (!Array.isArray(args.rows) || args.rows.length === 0)
          throw new WriterError("INVALID_ARGS", "rows 不能为空");
        const rows = args.rows.map((r) => ({
          rev: m.current_rev,
          原句: r.原句,
          改后: r.改后,
          病型: r.病型,
          at: nowIso(),
        }));
        await store.writable();
        const total = await serialize(store.editsPath(id), async () => {
          const prev = (await readJson<unknown[]>(store.editsPath(id))) ?? [];
          await atomicWrite(store.editsPath(id), JSON.stringify([...prev, ...rows], null, 2));
          return prev.length + rows.length;
        });
        return { added: rows.length, total };
      },
    }),

    defineWriterTool<{ id: string; mode?: string }>({
      name: "toutiao_qa_check",
      description:
        "S6 质检当前版稿件（带立项卡与台账核对）。结果与稿件哈希、立项卡哈希绑定；改稿或改卡后需重跑。过线 = 综合 ≥ 84、零 fail、无硬闸。",
      properties: {
        id: ID,
        mode: E(["long", "short", "micro"], "体裁模式；立项卡写了体裁就不用给"),
      },
      required: ["id"],
      async run(args, exec) {
        const store = await st(exec);
        const id = reqStr(args, "id");
        const m = await store.get(id);
        const cur = store.currentDraft(m);
        if (!cur) throw new WriterError("NOT_FOUND", "还没有稿件，先 toutiao_draft_stage");
        const text = await store.readDraft(id, cur.rev);
        if (sha256(text) !== cur.sha256)
          throw new WriterError(
            "CONFLICT",
            "稿件文件被外部改动，与记录哈希不一致；请重新 toutiao_draft_stage",
          );
        const cardText = await readText(store.cardPath(id));
        const a = [
          "qa",
          "--file",
          store.draftPath(id, cur.rev),
          "--ledger",
          store.ledgerPath,
          "--article-id",
          id,
        ];
        if (cardText !== undefined) a.push("--card", store.cardPath(id));
        if (args.mode) a.push("--mode", args.mode);
        const r = await bridge(config, a, { timeoutMs: 120_000, signal: exec.signal });
        const hardGates = scriptStrArray(r.hard_gates, "hard_gates");
        const fails = scriptArray(r.fails, "fails");
        const report =
          r.report && typeof r.report === "object"
            ? (r.report as { items?: unknown[] })
            : undefined;
        const dims = dimsOf(report);
        const rec = {
          rev: cur.rev,
          sha256: cur.sha256,
          pass: r.pass === true,
          score: Number(r.score ?? 0),
          hard_gates: hardGates,
          fail_count: fails.length,
          rules_version: r.rules_version,
          card_sha256: cardText === undefined ? null : sha256(cardText),
          at: nowIso(),
          ...(dims ? { dims } : {}),
        };
        await store.update(id, (mm) => {
          mm.qa.push(rec);
        });
        const warn =
          cardText === undefined ? ["没有立项卡，未做立项卡与台账核对；交稿前必须补卡并重跑"] : [];
        return {
          pass: rec.pass,
          score: rec.score,
          verdict: r.verdict,
          hard_gates: hardGates,
          fails,
          warnings: [...warn, ...scriptStrArray(r.warnings, "warnings")],
          title: r.title,
          title_len: r.title_len,
          chars: r.chars,
          rules_version: r.rules_version,
          rev: cur.rev,
          dims: rec.dims ?? null,
          items: report?.items ?? [],
        };
      },
    }),

    defineWriterTool<{ id: string; to: string; note?: string }>({
      name: "toutiao_status",
      description:
        '改文章状态。初稿待改→待验收→已验收/验收退回→已交稿。已验收需当前版质检过线；验收退回超过两轮需作者同意；已交稿只能由作者确认（会弹出确认，或请作者在写作台点"采用"）。',
      properties: { id: ID, to: E(STATUSES, "目标状态"), note: S("原因或说明") },
      required: ["id", "to"],
      async run(args, exec) {
        const store = await st(exec);
        const id = reqStr(args, "id");
        const to = reqStr(args, "to") as Status;
        if (!STATUSES.includes(to))
          throw new WriterError("INVALID_ARGS", `状态只能是：${STATUSES.join(" / ")}`);
        const before = await store.get(id);
        if (!canTransition(before.status, to))
          throw new WriterError("CONFLICT", `不能从「${before.status}」改到「${to}」`);
        if (to === "待验收" && before.current_rev === 0)
          throw new WriterError("CONFLICT", "还没有稿件");
        if (to === "待验收" && config.requireEditorPass) {
          const cur = store.currentDraft(before);
          if (cur && cur.role === "writer")
            throw new WriterError(
              "GATE_DENIED",
              "当前版本还没经过编辑红笔：请用头条编辑子代理改过再送验收",
            );
        }
        if (to === "已验收") {
          const v = await validPassingQa(store, before);
          if (!v.ok) throw new WriterError("GATE_DENIED", v.reason);
          if (!(await store.readCard(id)))
            throw new WriterError("GATE_DENIED", "没有立项卡，不能验收");
        }
        const gates = deps.gates();
        if (
          to === "验收退回" &&
          before.return_rounds >= MAX_RETURN_ROUNDS &&
          gates?.isActive("toutiao.max_return_rounds")
        ) {
          if (!gates.consumeConfirmation(exec, "toutiao.max_return_rounds"))
            throw new WriterError(
              "GATE_DENIED",
              `已打回 ${before.return_rounds} 轮，第三轮需作者同意`,
            );
        }
        if (to === "已交稿") {
          if (!before.delivered)
            throw new WriterError("GATE_DENIED", "还没有交稿单（toutiao_delivery_save）");
          if (!gates || !gates.consumeConfirmation(exec, "toutiao.deliver_requires_author")) {
            throw new WriterError(
              "GATE_DENIED",
              '"已交稿"必须由作者明确采用：请作者在弹出的确认中同意，或在写作台点"采用"',
            );
          }
        }
        const m = await store.update(id, (mm) => {
          if (mm.status !== before.status)
            throw new WriterError("CONFLICT", "状态已被其他操作改变，请重试");
          if (to === "验收退回") mm.return_rounds += 1;
          mm.history.push({
            from: mm.status,
            to,
            by: to === "已交稿" ? "author" : "agent",
            at: nowIso(),
            note: optStr(args, "note"),
          });
          mm.status = to;
        });
        // allow-catch: article status is already committed; report ledger failure explicitly for repair.
        const ledger = await syncLedgerStatus(config, store, m).catch((e: unknown) => ({
          synced: false,
          message: e instanceof Error ? e.message : String(e),
        }));
        return { article: summary(m), ledger };
      },
    }),

    defineWriterTool<{ id: string; markdown: string }>({
      name: "toutiao_delivery_save",
      description:
        "S7 保存交稿单（按 template-delivery）。仅限 已验收 的文章；必须含主标题与当前终稿正文；末句自动固定为止步句。",
      properties: { id: ID, markdown: S("交稿单 Markdown 全文") },
      required: ["id", "markdown"],
      async run(args, exec) {
        const store = await st(exec);
        const id = reqStr(args, "id");
        const m = await store.get(id);
        if (m.status !== "已验收")
          throw new WriterError("GATE_DENIED", `只有 已验收 的文章能出交稿单（当前：${m.status}）`);
        const v = await validPassingQa(store, m);
        if (!v.ok) throw new WriterError("GATE_DENIED", v.reason);
        let md = String(args.markdown ?? "")
          .replace(/\r\n/g, "\n")
          .trim();
        if (!md) throw new WriterError("INVALID_ARGS", "markdown 不能为空");
        const problems: string[] = [];
        const slot = md.match(/\[(?:主标题|标题|事实与所在句|链接|时间|X|字数|分)\]/);
        if (slot) problems.push(`还有模板槽位没填：${slot[0]}`);
        const main = m.headlines.main;
        if (main && !md.includes(main)) problems.push("交稿单里没有主推标题");
        const draft = await store.readDraft(id, m.current_rev);
        const probe = draft
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("#") && !s.startsWith("【配图"))
          .slice(0, 2);
        if (probe.some((p) => !md.includes(p)))
          problems.push("交稿单正文与当前终稿不一致（终稿开头段落没找到）");
        if (problems.length) throw new WriterError("INVALID_ARGS", problems.join("；"));
        md = md
          .split("\n")
          .filter((l) => !l.includes("AI 到此止步"))
          .join("\n")
          .trimEnd();
        md += `\n\n---\n> ${STOP_LINE}\n`;
        await store.writable();
        await atomicWrite(store.deliveryPath(id), md);
        const after = await store.update(id, (mm) => {
          mm.delivered = true;
        });
        return { article: summary(after), path: store.deliveryPath(id), chars: [...md].length };
      },
    }),

    defineWriterTool<{ id: string }>({
      name: "toutiao_ledger_add",
      description: "S7 把这篇记进发稿台账（只记立项字段，不存正文）。同一篇只记一次。",
      properties: { id: ID },
      required: ["id"],
      async run(args, exec) {
        const store = await st(exec);
        const id = reqStr(args, "id");
        const m = await store.get(id);
        if (!(await store.readCard(id))) throw new WriterError("NOT_FOUND", "没有立项卡");
        await store.writable();
        const r = await bridge(
          config,
          [
            "ledger-add",
            "--article-id",
            id,
            "--card",
            store.cardPath(id),
            "--ledger",
            store.ledgerPath,
            "--status",
            m.status,
            "--date",
            id.slice(0, 10),
          ],
          { signal: exec.signal },
        );
        return { row: r.row, ledger: store.ledgerPath };
      },
    }),

    defineWriterTool<{ last?: number }>({
      name: "toutiao_ledger_show",
      description:
        "S1/S2 读发稿台账最近若干行（防撞题撞脸），并附“同垂类同母体历史表现”：有平台回流数据的文章按垂类+母体分组展示，样本 <10 篇只展示不计推荐。",
      properties: { last: I("最近几行，默认 10") },
      async run(args, exec) {
        const store = await st(exec);
        const r = await bridge(
          config,
          [
            "ledger-show",
            "--ledger",
            store.ledgerPath,
            "--last",
            String(Math.max(1, Number(args.last ?? 10) || 10)),
          ],
          { signal: exec.signal },
        );
        return {
          rows: r.rows,
          total: r.total,
          performance: scriptArray(r.performance, "performance"),
        };
      },
    }),

    defineWriterTool<{ articleId: string; url?: string; metrics?: unknown[]; csv?: string }>({
      name: "toutiao_metrics_import",
      description:
        "把平台数据回流进发稿台账（展现/阅读/完读率/平均时长/评论/转发/涨粉）。一篇文章一行，整批取数据日期最新的一天做快照；文章要先 toutiao_ledger_add 记过账。metrics 给对象数组，或 csv 给粘贴的表格文本（表头 日期,展现,阅读,完读率,平均时长,评论,转发,涨粉），二选一。",
      properties: {
        articleId: ID,
        url: S("发布页链接，可选；首次导入后记进台账，之后可凭 url 定位"),
        metrics: {
          type: "array",
          description:
            "每天一行：{date, impressions?, reads?, readRate?, avgReadSeconds?, comments?, shares?, follows?}，数值可给数字或原文文本",
        },
        csv: S(
          "粘贴的 CSV 文本（表头 日期,展现,阅读,完读率,平均时长,评论,转发,涨粉），与 metrics 二选一",
        ),
      },
      required: ["articleId"],
      async run(args, exec) {
        const store = await st(exec);
        await store.writable();
        const articleId = reqStr(args, "articleId");
        const url = optStr(args, "url") ?? "";
        const rows =
          args.metrics !== undefined
            ? normalizeMetricRows(metricObjects(args.metrics))
            : csvMetricRows(reqStr(args, "csv"));
        const r = await bridge(
          config,
          [
            "metrics-import",
            "--article-id",
            articleId,
            ...(url ? ["--url", url] : []),
            "--metrics-json",
            JSON.stringify(rows),
            "--ledger",
            store.ledgerPath,
          ],
          { signal: exec.signal },
        );
        return {
          row: r.row,
          kept: r.kept === true,
          snapshot_date: r.snapshot_date,
          ledger: store.ledgerPath,
        };
      },
    }),

    defineWriterTool<{
      original: string;
      revised: string;
      motive: string;
      病型?: string;
      位置?: string;
      改法?: string;
    }>({
      name: "toutiao_feedback_append",
      description:
        '作者改稿后记录"原文 → 改后 → 动机"，以后每次开工先读。知道病灶时可附结构化字段：病型（s5-editing 的 1~16 或 G1~G4）、位置（第几段/哪一节）、改法（一句话处方）——同类病型满三次会提醒固化进方法。',
      properties: {
        original: S("原文"),
        revised: S("作者改后"),
        motive: S("作者的动机"),
        病型: S("病型编号与名称，如 3·大词空转 或 G2·寓意说教"),
        位置: S("病灶位置，如 第 4 段 / 延伸节"),
        改法: S("一句话改法"),
      },
      required: ["original", "revised", "motive"],
      async run(args, exec) {
        const store = await st(exec);
        await store.writable();
        const entry: FeedbackEntry = {
          date: today(),
          original: reqStr(args, "original"),
          revised: reqStr(args, "revised"),
          motive: reqStr(args, "motive"),
        };
        for (const key of ["病型", "位置", "改法"] as const) {
          const value = optStr(args, key);
          if (value) entry[key] = value;
        }
        const line = `${formatFeedbackLine(entry)}\n`;
        // 首条要写表头：查存在与写入须串行，否则并发的两条首记录会互相覆盖。
        await serialize(store.feedbackPath, async () => {
          const prev = await readText(store.feedbackPath);
          if (prev === undefined)
            await atomicWrite(store.feedbackPath, `# 作者改稿反馈\n\n${line}`);
          else await appendFile(store.feedbackPath, line, "utf8");
        });
        return { path: store.feedbackPath };
      },
    }),

    defineWriterTool({
      name: "toutiao_feedback_read",
      description:
        "开工先读作者改稿反馈。text 是原始行式；items 是解析后的结构化条目（新旧两种行式都支持）；同一病型满三次时在 hints 里提醒固化进方法。",
      properties: {},
      async run(_a, exec) {
        const store = await st(exec);
        const text = (await readText(store.feedbackPath)) ?? "";
        const items = parseFeedbackEntries(text);
        const counts = new Map<string, number>();
        for (const item of items) {
          if (!item.病型) continue;
          counts.set(item.病型, (counts.get(item.病型) ?? 0) + 1);
        }
        const hints = [...counts.entries()]
          .filter(([, n]) => n >= 3)
          .map(
            ([disease, n]) =>
              `病型“${disease}”已反馈 ${n} 次：建议把改法固化进方法方案（toutiao_profile）`,
          );
        return { text, entries: items.length, items, hints };
      },
    }),

    createProfileTool("toutiao_profile", toutiaoLibrary, {
      pinned: config.profile,
      methodTool: "toutiao_method_get",
    }),
  ].filter((tool) =>
    deps.role === "planner"
      ? PLANNER_TOOLS.has(tool.name)
      : deps.role !== "editor" || EDITOR_TOOLS.has(tool.name),
  );
}

async function saveCard(
  store: Awaited<ReturnType<typeof storeFor>>,
  id: string,
  card: Record<string, unknown>,
  titleMax: number,
  drivers: readonly string[],
) {
  const issues = checkCard(card, titleMax, drivers);
  const sha = await store.writeCard(id, card);
  const line = typeof card["内容线"] === "string" ? card["内容线"] : "";
  const genre = typeof card["体裁"] === "string" ? card["体裁"] : "";
  await store.update(id, (m) => {
    if (line) m.line = line;
    if (genre) m.genre = genre;
  });
  return { saved: true, card_sha256: sha, ready: !issues.some((i) => i.level === "fail"), issues };
}

/** 文章状态变化后同步台账里同标题那一行（若已记账） */
export async function syncLedgerStatus(
  config: ToutiaoConfig,
  store: Awaited<ReturnType<typeof storeFor>>,
  m: ArticleMeta,
) {
  const title = String((await store.readCard(m.id))?.["主标题"] ?? "");
  if (!title || !(await readText(store.ledgerPath))) return { synced: false };
  try {
    await bridge(config, [
      "ledger-status",
      "--article-id",
      m.id,
      "--title",
      title,
      "--to",
      m.status,
      "--ledger",
      store.ledgerPath,
    ]);
    return { synced: true };
  } catch (e) {
    if (e instanceof WriterError && e.code === "NOT_FOUND") return { synced: false };
    throw e;
  }
}
