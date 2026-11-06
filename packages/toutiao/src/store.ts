import { mkdir } from "node:fs/promises";
import { claimWorkspace, assertWorkspaceWritable } from "../../core/src/workspace-lock.js";
/**
 * 头条文章存储。目录布局：
 *
 *   <root>/                       默认 <会话 cwd>/outputs/toutiao
 *     log.csv                     发稿台账（由 Python ledger 读写，格式不变）
 *     feedback.md                 作者改稿反馈
 *     <id>/                       一篇文章，id = YYYY-MM-DD-slug
 *       meta.json                 插件独占写入
 *       立项卡.json
 *       drafts/rev-001.md …       每一版稿件，只增不改
 *       edits.json                S5 三联改写留痕
 *       交稿单.md
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { WriterError } from "../../core/src/tool.js";
import {
  atomicWrite,
  exists,
  isMissingFileError,
  readJson,
  readText,
  resolveInside,
  serialize,
  sha256,
} from "../../core/src/fsx.js";

export const STATUSES = ["初稿待改", "待验收", "已验收", "验收退回", "已交稿"] as const;
export type Status = (typeof STATUSES)[number];
export const LINES = ["资讯线", "故事线"] as const;
export const GENRES = ["长图文", "短图文", "微头条"] as const;

export const MAX_RETURN_ROUNDS = 2;
export const STOP_LINE = "——AI 到此止步。是否采用、何时发布由你决定。";

export interface DraftRecord {
  rev: number;
  role: string;
  sha256: string;
  chars: number;
  created_at: string;
  note: string;
}
/** 六维分项（qa_check 六个 item 的分数）。旧记录没有 dims 字段，读取时按缺省处理。 */
export interface QaDims {
  ai: number;
  read: number;
  title: number;
  detail: number;
  structure: number;
  compliance: number;
}
/** 读者评审九项标尺（packages/core/eval/judge-toutiao-article.md）。 */
export const READER_RUBRIC = [
  "标题",
  "开篇三段",
  "人物",
  "引语",
  "延伸",
  "节奏",
  "结尾",
  "不像模板",
  "读完意愿",
] as const;
export type ReaderRubricItem = (typeof READER_RUBRIC)[number];
export interface ReaderReview {
  /** 被评审的稿件版本 */
  rev: number;
  at: string;
  scores: Record<ReaderRubricItem, number>;
  evidences: Record<ReaderRubricItem, string>;
}
export interface QaRecord {
  rev: number;
  sha256: string;
  pass: boolean;
  score: number;
  hard_gates: string[];
  fail_count: number;
  rules_version: string;
  card_sha256: string | null;
  at: string;
  dims?: QaDims;
  /** qa.judge 开启时由编辑子会话写入；与该记录同一稿件版本 */
  readerReview?: ReaderReview;
}
export interface HistoryRecord {
  from: Status | null;
  to: Status;
  by: string;
  at: string;
  note?: string;
}

export interface ArticleMeta {
  schema: 1;
  id: string;
  title_hint: string;
  line: string;
  genre: string;
  status: Status;
  current_rev: number;
  drafts: DraftRecord[];
  qa: QaRecord[];
  return_rounds: number;
  headlines: { main: string; alts: string[] };
  delivered: boolean;
  history: HistoryRecord[];
  created_at: string;
  updated_at: string;
}

/** 允许的状态跳转（不含门禁；门禁另查） */
const TRANSITIONS: Record<Status, Status[]> = {
  初稿待改: ["待验收"],
  待验收: ["已验收", "验收退回", "初稿待改"],
  验收退回: ["初稿待改", "待验收"],
  已验收: ["已交稿", "验收退回"],
  已交稿: [],
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

export { nowIso } from "../../core/src/fsx.js";
import { localDay, nowIso } from "../../core/src/fsx.js";

export function today(): string {
  return localDay();
}

const SLUG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,40}$/u;
const ID_RE = /^\d{4}-\d{2}-\d{2}-[\p{L}\p{N}][\p{L}\p{N}_-]{0,40}$/u;

export class ArticleStore {
  constructor(readonly root: string) {}

  get ledgerPath(): string {
    return path.join(this.root, "log.csv");
  }
  get feedbackPath(): string {
    return path.join(this.root, "feedback.md");
  }

  dir(id: string): string {
    if (!ID_RE.test(id))
      throw new WriterError(
        "INVALID_ARGS",
        `文章 id 不合法：${id}（应为 YYYY-MM-DD-简短英文或拼音或中文）`,
      );
    return resolveInside(this.root, id);
  }
  metaPath(id: string) {
    return path.join(this.dir(id), "meta.json");
  }
  cardPath(id: string) {
    return path.join(this.dir(id), "立项卡.json");
  }
  draftPath(id: string, rev: number) {
    return path.join(this.dir(id), "drafts", `rev-${String(rev).padStart(3, "0")}.md`);
  }
  editsPath(id: string) {
    return path.join(this.dir(id), "edits.json");
  }
  deliveryPath(id: string) {
    return path.join(this.dir(id), "交稿单.md");
  }

  async writable() {
    await mkdir(this.root, { recursive: true });
    await claimWorkspace(this.root);
    await assertWorkspaceWritable(this.root);
  }

  async create(
    slug: string,
    opts: { date?: string; titleHint?: string; line?: string; genre?: string },
  ): Promise<ArticleMeta> {
    await this.writable();
    const s = slug.trim();
    if (!SLUG_RE.test(s))
      throw new WriterError("INVALID_ARGS", "slug 只能用字母、数字、中文、-、_，最长 41 字");
    const date = opts.date ?? today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new WriterError("INVALID_ARGS", "date 格式应为 YYYY-MM-DD");
    const id = `${date}-${s}`;
    return serialize(this.metaPath(id), async () => {
      if (await exists(this.metaPath(id))) throw new WriterError("CONFLICT", `文章已存在：${id}`);
      const at = nowIso();
      const meta: ArticleMeta = {
        schema: 1,
        id,
        title_hint: opts.titleHint ?? "",
        line: opts.line ?? "",
        genre: opts.genre ?? "",
        status: "初稿待改",
        current_rev: 0,
        drafts: [],
        qa: [],
        return_rounds: 0,
        headlines: { main: "", alts: [] },
        delivered: false,
        history: [{ from: null, to: "初稿待改", by: "agent", at, note: "立项" }],
        created_at: at,
        updated_at: at,
      };
      await atomicWrite(this.metaPath(id), JSON.stringify(meta, null, 2));
      return meta;
    });
  }

  async get(id: string): Promise<ArticleMeta> {
    const meta = await readJson<ArticleMeta>(this.metaPath(id));
    if (!meta) throw new WriterError("NOT_FOUND", `没有这篇文章：${id}`);
    return meta;
  }

  /** 读改写 meta.json，同一文章串行 */
  async update(id: string, fn: (m: ArticleMeta) => Promise<void> | void): Promise<ArticleMeta> {
    await this.writable();
    return serialize(this.metaPath(id), async () => {
      const meta = await this.get(id);
      await fn(meta);
      meta.updated_at = nowIso();
      await atomicWrite(this.metaPath(id), JSON.stringify(meta, null, 2));
      return meta;
    });
  }

  async list(issues?: { root: string; id?: string; error: string }[]): Promise<ArticleMeta[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
    const validNames = names.filter((n) => ID_RE.test(n));
    const out: ArticleMeta[] = [];
    for (let offset = 0; offset < validNames.length; offset += 16) {
      const batch = validNames.slice(offset, offset + 16);
      const results = await Promise.all(
        batch.map(async (n) => {
          try {
            const m = await this.get(n);
            if (
              !Array.isArray(m.qa) ||
              !Array.isArray(m.drafts) ||
              typeof m.updated_at !== "string" ||
              !m.headlines ||
              !STATUSES.includes(m.status)
            )
              throw new WriterError("CONFLICT", `文章元数据格式损坏：${n}`);
            return { ok: true as const, meta: m };
          } catch (error) {
            if (!issues) throw error;
            return {
              ok: false as const,
              id: n,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );
      for (const r of results) {
        if (r.ok) out.push(r.meta);
        else issues?.push({ root: this.root, id: r.id, error: r.error });
      }
    }
    out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return out;
  }

  async readCard(id: string): Promise<Record<string, unknown> | undefined> {
    return readJson<Record<string, unknown>>(this.cardPath(id));
  }

  async writeCard(id: string, card: Record<string, unknown>): Promise<string> {
    await this.writable();
    await this.get(id);
    const text = JSON.stringify(card, null, 2);
    await atomicWrite(this.cardPath(id), text);
    return sha256(text);
  }

  async cardSha(id: string): Promise<string | null> {
    const t = await readText(this.cardPath(id));
    return t === undefined ? null : sha256(t);
  }

  async readDraft(id: string, rev: number): Promise<string> {
    const t = await readText(this.draftPath(id, rev));
    if (t === undefined) throw new WriterError("NOT_FOUND", `没有第 ${rev} 版稿件`);
    return t;
  }

  /** 新增一版稿件（只增不改）。已交稿的文章不再接受新稿。 */
  async stageDraft(
    id: string,
    text: string,
    role: string,
    note: string,
    expected?: { rev: number; sha256: string },
  ): Promise<ArticleMeta> {
    await this.writable();
    return this.update(id, async (m) => {
      if (m.status === "已交稿")
        throw new WriterError("CONFLICT", "这篇已交稿，不能再改；需要改写请新开一篇");
      if (
        expected &&
        (m.current_rev !== expected.rev || (this.currentDraft(m)?.sha256 || "") !== expected.sha256)
      )
        throw new WriterError("CONFLICT", "文章已变化，请保留当前修改并重新核对最新稿件。");
      const rev = m.current_rev + 1;
      const file = this.draftPath(id, rev);
      if (await exists(file))
        throw new WriterError("CONFLICT", `第 ${rev} 版已存在，meta 与稿件目录不一致`);
      await atomicWrite(file, text);
      m.drafts.push({
        rev,
        role,
        sha256: sha256(text),
        chars: [...text].length,
        created_at: nowIso(),
        note,
      });
      m.current_rev = rev;
      if (m.status !== "初稿待改") {
        m.history.push({
          from: m.status,
          to: "初稿待改",
          by: "agent",
          at: nowIso(),
          note: `新稿 rev ${rev}`,
        });
        m.status = "初稿待改";
      }
    });
  }

  currentDraft(m: ArticleMeta): DraftRecord | undefined {
    return m.drafts.find((d) => d.rev === m.current_rev);
  }

  /** 当前版本最近一次质检是否过线，且稿件与立项卡都没改过 */
  latestQaFor(m: ArticleMeta): QaRecord | undefined {
    const cur = this.currentDraft(m);
    if (!cur) return undefined;
    const hits = m.qa.filter((q) => q.rev === cur.rev && q.sha256 === cur.sha256);
    return hits[hits.length - 1];
  }

  /** 读者评审落到 meta.qa 最近一条（与该次质检同一稿件版本）。没有质检记录时返回 false。 */
  async attachReaderReview(id: string, review: ReaderReview): Promise<boolean> {
    const m = await this.update(id, (meta) => {
      const last = meta.qa[meta.qa.length - 1];
      if (last) last.readerReview = review;
    });
    return Boolean(m.qa[m.qa.length - 1]?.readerReview);
  }
}

/** 从编辑回报文本里解析读者评审：取最后一个能通过校验的 JSON 对象；没有就返回 null。 */
export function parseReaderReview(raw: string, rev: number, at: string): ReaderReview | null {
  for (const span of balancedJsonObjects(raw).reverse()) {
    let value: unknown;
    try {
      value = JSON.parse(span);
    } catch {
      continue; // allow-catch: 候选片段不是 JSON 就换上一个候选，评估文本本身失败由调用方兜底
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const scores = (value as Record<string, unknown>)["scores"];
    const evidences = (value as Record<string, unknown>)["evidences"];
    if (
      !isRubricMap(scores, (x) => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 5)
    )
      continue;
    if (!isRubricMap(evidences, (x) => typeof x === "string" && x.trim().length > 0)) continue;
    return {
      rev,
      at,
      scores: scores as ReaderReview["scores"],
      evidences: evidences as ReaderReview["evidences"],
    };
  }
  return null;
}

/** 文本里所有配平的 {...} 片段，按出现顺序。 */
function balancedJsonObjects(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return out;
}

function isRubricMap(
  value: unknown,
  ok: (item: unknown) => boolean,
): value is Record<ReaderRubricItem, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const map = value as Record<string, unknown>;
  return READER_RUBRIC.every((key) => typeof map[key] !== "undefined" && ok(map[key]));
}

/** 作者改稿反馈的两种行式：
 *  旧：`- 日期：原文 → 改后 → 动机`
 *  新：尾部再附 `｜ 病型=… ｜ 位置=… ｜ 改法=…`（键=值，可只附其中几键）。 */
export interface FeedbackEntry {
  date: string;
  original: string;
  revised: string;
  motive: string;
  病型?: string;
  位置?: string;
  改法?: string;
}

const FEEDBACK_TAGS = ["病型", "位置", "改法"] as const;

export function parseFeedbackEntries(text: string): FeedbackEntry[] {
  const out: FeedbackEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("- ")) continue;
    const [head, ...tags] = line.slice(2).split("｜");
    const parts = head.split(" → ");
    if (parts.length < 3) continue;
    const dateMatch = /^(\d{4}-\d{2}-\d{2})：/.exec(parts[0].trim());
    const entry: FeedbackEntry = {
      date: dateMatch ? dateMatch[1] : "",
      original: parts[0].replace(/^\d{4}-\d{2}-\d{2}：/, "").trim(),
      revised: parts.slice(1, -1).join(" → ").trim(),
      motive: parts[parts.length - 1].trim(),
    };
    for (const tag of tags) {
      const eq = tag.indexOf("=");
      if (eq <= 0) continue;
      const key = tag.slice(0, eq).trim();
      const value = tag.slice(eq + 1).trim();
      if ((FEEDBACK_TAGS as readonly string[]).includes(key) && value)
        entry[key as (typeof FEEDBACK_TAGS)[number]] = value;
    }
    out.push(entry);
  }
  return out;
}

/** 渲染一条反馈为行式（append 与 S4 附件共用同一格式）。 */
export function formatFeedbackLine(entry: FeedbackEntry): string {
  const tags = FEEDBACK_TAGS.filter((key) => entry[key])
    .map((key) => `${key}=${entry[key]}`)
    .join(" ｜ ");
  const head = `- ${entry.date}：${entry.original} → ${entry.revised} → ${entry.motive}`;
  return tags ? `${head} ｜ ${tags}` : head;
}
