/**
 * WorkbenchCommand 分派：44 条命令一一对应（编译期由映射类型检查齐全）。
 * 输入先经 core/schema 解析；所有路径必须位于写作文件夹内；
 * 读写策略与刷新广播在 COMMAND_POLICY（workbench/contract）一处，由 IPC 层执行。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import type { LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { arr, bool, int, lit, obj, opt, str, type Parser } from "@zhizhang/core/schema";
import {
  alignTwoLevel,
  classifyHunks,
  commands as fanqie,
  createLearningStore,
  type BibleOp,
  type Provenance,
} from "@zhizhang/fanqie";
import { commands as toutiao } from "@zhizhang/toutiao";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import { wordDocument } from "../exports.js";
import type { WorkbenchCall } from "../shared/ipc.js";
import type { WorkspaceRoots } from "../shared/views.js";
import { PROFILE_HANDLERS, PROFILE_INPUTS, type ProfileDirs } from "./commands-profiles.js";
import type { WorkflowService } from "./workflow.js";

export interface CommandCtx {
  clock: Clock;
  locks: LockService;
  /** 把输入路径约束在写作文件夹内，返回规范化的绝对路径。 */
  inside(target: string): string;
  roots(): WorkspaceRoots;
  profiles: ProfileDirs;
  scriptsDir?: string;
  workflow: Pick<WorkflowService, "startAndWait">;
  log?(event: string, data: Record<string, unknown>): void;
}

type Handler<K extends WorkbenchCommand> = (input: CommandInput<K>, ctx: CommandCtx) => Promise<CommandResult<K>>;
type Group<P extends string> = Extract<WorkbenchCommand, `${P}.${string}`>;

const id = str({ min: 1, max: 200 });
const grade = lit("economy", "standard", "premium");
const BIBLE_OP_TYPES = ["entity.upsert", "state.add", "thread.upsert", "knowledge.set", "chapter.record"] as const;
const BIBLE_OP_KEYS: Record<(typeof BIBLE_OP_TYPES)[number], string> = {
  "entity.upsert": "entity",
  "state.add": "entry",
  "thread.upsert": "thread",
  "knowledge.set": "row",
  "chapter.record": "record",
};

/** 圣经增量只做结构校验（类型 + 载荷对象），字段语义由圣经存储在写入时裁定。 */
const bibleOp: Parser<BibleOp> = (value, at = "$") => {
  const shape = obj({ type: lit(...BIBLE_OP_TYPES) }, { strict: false })(value, at);
  const key = BIBLE_OP_KEYS[shape.type];
  const payload: unknown = typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new AppError("input.invalid", `${at}.${key}: expected object`, { path: `${at}.${key}` });
  }
  return value as BibleOp;
};

const provenance: Parser<Provenance> = obj({
  source: lit("plan", "ledger", "author"),
  run: opt(str()),
  chapter: opt(int({ min: 1 })),
  at: str({ min: 1 }),
});

const decision: Parser<"accept" | "reject" | { edit: BibleOp }> = (value, at = "$") =>
  value === "accept" || value === "reject" ? value : obj({ edit: bibleOp })(value, at);

const INPUTS: { [K in WorkbenchCommand]: Parser<CommandInput<K>> } = {
  "fanqie.snapshot": obj({ work: id, since: opt(str()) }),
  "fanqie.chapter.list": obj({ work: id }),
  "fanqie.chapter.get": obj({ work: id, chapter: id }),
  "fanqie.chapter.save": obj({ work: id, chapter: id, base: str(), body: str({ max: 2_000_000 }), title: opt(str({ max: 100, trim: true })) }),
  "fanqie.chapter.finalize": obj({ work: id, chapter: id }),
  "fanqie.candidate.list": obj({ work: id, chapter: opt(id) }),
  "fanqie.candidate.get": obj({ work: id, chapter: id, candidateId: id }),
  "fanqie.candidate.accept": obj({ work: id, chapter: id, candidateId: id, base: str() }),
  "fanqie.candidate.reject": obj({ work: id, chapter: id, candidateId: id, reason: opt(str({ max: 2000 })) }),
  "fanqie.work.list": obj({ root: id }),
  "fanqie.work.get": obj({ work: id }),
  "fanqie.work.create": obj({ root: id, title: str({ min: 1, max: 100, trim: true }), premise: str({ max: 20000 }), grade }),
  "fanqie.work.settings": obj({
    work: id,
    grade: opt(grade),
    profile: opt(id),
    requireEditorPass: opt(bool),
    targetWords: opt(int({ min: 500, max: 20000 })),
    previousTextMode: opt(lit("auto", "full", "tail")),
  }),
  "fanqie.book.export": obj({ work: id, format: lit("txt", "docx"), finalOnly: bool, outPath: id }),
  "fanqie.bible.get": obj({ work: id }),
  "fanqie.bible.view": obj({ work: id, position: int({ min: 1 }) }),
  "fanqie.bible.propose": obj({ work: id, ops: arr(bibleOp, { max: 200 }), from: provenance }),
  "fanqie.bible.decide": obj({ work: id, id, decision }),
  "fanqie.bible.audit": obj({ work: id, upTo: int({ min: 1 }) }),
  "fanqie.reference.bind": obj({ work: id, sourceId: id, cardIds: opt(arr(id, { max: 200 })) }),
  "toutiao.articles": obj({ root: id }),
  "toutiao.article.create": obj({ root: id, genre: id, driver: id }),
  "toutiao.article.transition": obj({ articleDir: id, to: id }),
  "toutiao.article.deliver": obj({ articleDir: id, title: str({ min: 1, max: 200 }), body: str({ min: 1, max: 400_000 }) }),
  "toutiao.article.export": obj({ articleDir: id, outPath: id, format: opt(lit("md", "txt")), includeDelivery: opt(bool) }),
  "toutiao.draft.get": obj({ articleDir: id }),
  "toutiao.draft.save": obj({ articleDir: id, title: opt(str({ max: 200 })), body: str({ min: 1, max: 400_000 }), revision: opt(str()) }),
  "toutiao.source.register": obj({ articleDir: id, sourceId: id, kind: lit("paste", "file", "classic"), content: str({ min: 1, max: 2_000_000 }) }),
  "toutiao.ledger.show": obj({ ledgerPath: id, last: opt(int({ min: 1, max: 200 })) }),
  "toutiao.ledger.add": obj({ cardPath: id, ledgerPath: id, articleId: opt(id), status: opt(id), date: opt(id) }),
  "toutiao.ledger.status": obj({ title: id, to: id, ledgerPath: id, articleId: opt(id) }),
  "toutiao.metrics.import": obj({ articleId: id, metricsJson: str({ min: 1, max: 400_000 }), ledgerPath: id, url: opt(str()) }),
  ...PROFILE_INPUTS,
  "library.import": obj({ libraryRoot: id, id: str({ min: 1, max: 80 }), title: str({ min: 1, max: 200 }), content: str({ min: 1, max: 20_000_000 }) }),
  "library.list": obj({ libraryRoot: id }),
  "library.cards": obj({ libraryRoot: id, sourceId: id }),
  "library.dissect": obj({ libraryRoot: id, sourceId: id, title: str({ min: 1, max: 200 }), sourcePath: opt(id) }),
};

function safeId(value: string, field: string): string {
  if (!/^[\w\u4e00-\u9fff-]{1,80}$/.test(value)) {
    throw new AppError("input.invalid", `${field} 只能包含字母、数字、汉字、下划线与连字符`, { field });
  }
  return value;
}

/** 书名转目录名：去掉文件系统保留字符，保留汉字。 */
function workDirName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  if (!name) throw new AppError("input.invalid", "书名不能只包含特殊字符", { field: "title" });
  return name;
}

function assertOutPath(outPath: string, ext: string): string {
  const resolved = path.resolve(outPath);
  if (!path.isAbsolute(outPath) || path.extname(resolved).toLowerCase() !== `.${ext}`) {
    throw new AppError("input.invalid", `导出路径须为 .${ext} 文件的绝对路径`, { field: "outPath" });
  }
  return resolved;
}

async function snapshotRevision(work: string, rows: unknown): Promise<string> {
  const structure = (await readTextIfExists(path.join(work, "plan", "structure.json"))) ?? "[]";
  return sha256(JSON.stringify({ rows, structure }));
}

async function learnFromEdit(ctx: CommandCtx, work: string, chapter: string, before: string, after: string): Promise<void> {
  const edits = classifyHunks(alignTwoLevel(before, after));
  if (edits.length === 0) return;
  try {
    await createLearningStore(ctx.locks).record(work, edits, { chapter, nowIso: ctx.clock.iso() });
  } catch (err) {
    // 学习记账失败不回滚已保存的正文，只记诊断
    ctx.log?.("learning_record_failed", { chapter, message: err instanceof Error ? err.message : String(err) });
  }
}

async function latestDraft(articleDir: string): Promise<{ file: string; text: string } | undefined> {
  const dir = path.join(articleDir, "drafts");
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => /^rev-[\w-]+\.md$/.test(n)).sort();
  let best: { file: string; mtime: number } | undefined;
  for (const name of names) {
    const stat = await fs.stat(path.join(dir, name));
    if (!best || stat.mtimeMs >= best.mtime) best = { file: name, mtime: stat.mtimeMs };
  }
  if (!best) return undefined;
  return { file: best.file, text: (await readTextIfExists(path.join(dir, best.file))) ?? "" };
}

const FANQIE: { [K in Group<"fanqie">]: Handler<K> } = {
  async "fanqie.snapshot"(input, ctx) {
    const work = ctx.inside(input.work);
    await fanqie.getWork(work);
    const rows = await fanqie.listChapters(work);
    const revision = await snapshotRevision(work, rows);
    if (input.since === revision) return { revision, full: false, rows: [], removedIds: [] };
    return { revision, full: true, rows, removedIds: [] };
  },
  async "fanqie.chapter.list"(input, ctx) {
    return { rows: await fanqie.listChapters(ctx.inside(input.work)) };
  },
  async "fanqie.chapter.get"(input, ctx) {
    const doc = await fanqie.readChapter(ctx.inside(input.work), input.chapter);
    return { id: doc.meta.id, title: doc.meta.title, body: doc.body, revision: doc.meta.revision, status: doc.meta.status };
  },
  async "fanqie.chapter.save"(input, ctx) {
    const work = ctx.inside(input.work);
    const chapter = safeId(input.chapter, "chapter");
    const before = await fanqie.readChapter(work, chapter).catch(() => undefined);
    const doc = await fanqie.saveChapter(
      work,
      {
        chapterId: chapter,
        body: input.body,
        ...(input.title ? { title: input.title } : {}),
        ...(input.base ? { expectedRevision: input.base } : {}),
      },
      ctx.locks,
    );
    if (before && before.body !== doc.body) await learnFromEdit(ctx, work, chapter, before.body, doc.body);
    const row = (await fanqie.listChapters(work)).find((r) => r.id === chapter);
    if (!row) throw new AppError("storage.io", `章节保存后未能读回：${chapter}`, { chapter });
    return { revision: doc.meta.revision, row };
  },
  async "fanqie.chapter.finalize"(input, ctx) {
    await fanqie.finalizeChapter(ctx.inside(input.work), { chapterId: input.chapter }, ctx.locks);
    return { status: "final" };
  },
  async "fanqie.candidate.list"(input, ctx) {
    return { candidates: await fanqie.listCandidates(ctx.inside(input.work), input.chapter) };
  },
  async "fanqie.candidate.get"(input, ctx) {
    return fanqie.readCandidate(ctx.inside(input.work), input.chapter, input.candidateId);
  },
  async "fanqie.candidate.accept"(input, ctx) {
    const work = ctx.inside(input.work);
    const current = await fanqie.readChapter(work, input.chapter).catch(() => undefined);
    if (current && input.base && current.meta.revision !== input.base) {
      throw new AppError("storage.conflict", "正文已在别处修改，请对照差异后再采纳", {
        expected: input.base,
        actual: current.meta.revision,
      });
    }
    const doc = await fanqie.acceptCandidate(work, { chapterId: input.chapter, candidateId: input.candidateId }, ctx.locks);
    return { revision: doc.meta.revision };
  },
  async "fanqie.candidate.reject"(input, ctx) {
    return fanqie.rejectCandidate(
      ctx.inside(input.work),
      { chapterId: input.chapter, candidateId: input.candidateId, ...(input.reason ? { reason: input.reason } : {}) },
      ctx.locks,
    );
  },
  async "fanqie.work.list"(input, ctx) {
    return { works: await fanqie.listWorks(ctx.inside(input.root)) };
  },
  async "fanqie.work.get"(input, ctx) {
    return fanqie.getWork(ctx.inside(input.work));
  },
  async "fanqie.work.create"(input, ctx) {
    const root = ctx.inside(input.root);
    const workPath = path.join(root, workDirName(input.title));
    await fanqie.createWork(
      workPath,
      { id: `w-${ctx.clock.now().toString(36)}`, title: input.title, grade: input.grade },
      ctx.locks,
    );
    if (input.premise.trim()) await atomicWrite(path.join(workPath, "plan", "premise.md"), `${input.premise.trim()}\n`);
    return { workPath };
  },
  async "fanqie.work.settings"(input, ctx) {
    const { work, ...patch } = input;
    return fanqie.updateWorkSettings(ctx.inside(work), patch, ctx.locks);
  },
  async "fanqie.book.export"(input, ctx) {
    const work = ctx.inside(input.work);
    const outPath = assertOutPath(input.outPath, input.format);
    if (input.format === "txt") {
      const result = await fanqie.exportWorkTxt(work, { onlyFinal: input.finalOnly, outPath });
      return { outPath, chapterCount: result.chapterCount };
    }
    const result = await fanqie.exportWorkTxt(work, { onlyFinal: input.finalOnly });
    await atomicWrite(outPath, await wordDocument(result.title, result.content));
    return { outPath, chapterCount: result.chapterCount };
  },
  async "fanqie.bible.get"(input, ctx) {
    return fanqie.readBible(ctx.inside(input.work), ctx.locks);
  },
  async "fanqie.bible.view"(input, ctx) {
    return fanqie.viewBibleAt(ctx.inside(input.work), input.position, ctx.locks);
  },
  async "fanqie.bible.propose"(input, ctx) {
    return { items: await fanqie.proposeBibleOps(ctx.inside(input.work), input.ops, input.from, ctx.locks) };
  },
  async "fanqie.bible.decide"(input, ctx) {
    await fanqie.decideBiblePending(ctx.inside(input.work), input.id, input.decision, ctx.locks);
    return { ok: true };
  },
  async "fanqie.bible.audit"(input, ctx) {
    return { findings: await fanqie.auditBible(ctx.inside(input.work), input.upTo, ctx.locks) };
  },
  async "fanqie.reference.bind"(input, ctx) {
    const work = ctx.inside(input.work);
    await fanqie.getWork(work);
    const library = ctx.roots().library;
    const { cards } = await fanqie.readLibraryCards(library, input.sourceId);
    const wanted = input.cardIds ?? cards.map((c) => c.id);
    const missing = wanted.filter((cardId) => !cards.some((c) => c.id === cardId));
    if (missing.length > 0 || wanted.length === 0) {
      throw new AppError("input.not_found", "拆书库里没有这些卡片", { sourceId: input.sourceId, missing });
    }
    const file = path.join(work, "plan", "references.json");
    await ctx.locks.write({ kind: "work", path: work }, async () => {
      const raw = await readTextIfExists(file);
      let bindings: Array<{ sourceId: string; cardIds: string[]; boundAt: string }> = [];
      if (raw !== undefined) {
        const data: unknown = JSON.parse(raw);
        const list = typeof data === "object" && data !== null ? Reflect.get(data, "bindings") : undefined;
        if (!Array.isArray(list)) throw new AppError("storage.format_unsupported", "plan/references.json 格式不受支持");
        bindings = list.filter(
          (b): b is { sourceId: string; cardIds: string[]; boundAt: string } =>
            typeof b === "object" && b !== null && typeof b.sourceId === "string" && Array.isArray(b.cardIds),
        );
      }
      const next = [
        ...bindings.filter((b) => b.sourceId !== input.sourceId),
        { sourceId: input.sourceId, cardIds: wanted, boundAt: ctx.clock.iso() },
      ];
      await atomicWrite(file, JSON.stringify({ format: FORMAT_VERSION, bindings: next }, null, 2));
    });
    return { work, sourceId: input.sourceId, boundCount: wanted.length };
  },
};

const TOUTIAO: { [K in Group<"toutiao">]: Handler<K> } = {
  async "toutiao.articles"(input, ctx) {
    return toutiao.listArticleRowsCommand(ctx.inside(input.root));
  },
  async "toutiao.article.create"(input, ctx) {
    const { articleDir } = await toutiao.createArticleCommand(
      { root: ctx.inside(input.root), genre: input.genre, driver: input.driver, ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}) },
      ctx.locks,
    );
    return { articleDir };
  },
  async "toutiao.article.transition"(input, ctx) {
    const { status } = await toutiao.transitionArticleCommand({ articleDir: ctx.inside(input.articleDir), to: input.to }, ctx.locks);
    return { status };
  },
  async "toutiao.article.deliver"(input, ctx) {
    const { deliveryPath } = await toutiao.deliverArticleCommand(
      {
        articleDir: ctx.inside(input.articleDir),
        title: input.title,
        body: input.body,
        ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
      },
      ctx.locks,
    );
    return { deliveryPath };
  },
  async "toutiao.article.export"(input, ctx) {
    const format = input.format ?? "md";
    return toutiao.exportArticleCommand({
      articleDir: ctx.inside(input.articleDir),
      outPath: assertOutPath(input.outPath, format),
      format,
      ...(input.includeDelivery !== undefined ? { includeDelivery: input.includeDelivery } : {}),
    });
  },
  async "toutiao.draft.get"(input, ctx) {
    const latest = await latestDraft(ctx.inside(input.articleDir));
    if (!latest) return { file: "", title: "", body: "", revision: "" };
    const heading = /^# (.+)\r?\n(?:\r?\n)?/.exec(latest.text);
    return {
      file: latest.file,
      title: heading ? heading[1].trim() : "",
      body: (heading ? latest.text.slice(heading[0].length) : latest.text).trimEnd(),
      revision: sha256(latest.text).slice(0, 12),
    };
  },
  async "toutiao.draft.save"(input, ctx) {
    const articleDir = ctx.inside(input.articleDir);
    return ctx.locks.write({ kind: "article", path: articleDir }, async () => {
      const latest = await latestDraft(articleDir);
      const latestRevision = latest ? sha256(latest.text).slice(0, 12) : "";
      if (input.revision !== undefined && input.revision !== latestRevision) {
        throw new AppError("storage.conflict", "草稿已有更新的版本，请刷新后再保存", {
          expected: input.revision,
          actual: latestRevision,
        });
      }
      const text = `${input.title?.trim() ? `# ${input.title.trim()}\n\n` : ""}${input.body.trim()}\n`;
      const existing = (await fs.readdir(path.join(articleDir, "drafts")).catch(() => [])).filter((n) =>
        /^rev-\d{3,}\.md$/.test(n),
      );
      const next = existing.reduce((max, n) => Math.max(max, Number.parseInt(n.slice(4), 10)), 0) + 1;
      const draftPath = path.join(articleDir, "drafts", `rev-${String(next).padStart(3, "0")}.md`);
      await atomicWrite(draftPath, text);
      return { draftPath, revision: sha256(text).slice(0, 12), chars: text.replace(/\s+/g, "").length };
    });
  },
  async "toutiao.source.register"(input, ctx) {
    return toutiao.registerSourceCommand(
      { articleDir: ctx.inside(input.articleDir), sourceId: safeId(input.sourceId, "sourceId"), kind: input.kind, content: input.content },
      ctx.locks,
    );
  },
  async "toutiao.ledger.show"(input, ctx) {
    return toutiao.ledgerShowCommand({
      ledgerPath: ctx.inside(input.ledgerPath),
      ...(input.last ? { last: input.last } : {}),
      ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
    });
  },
  async "toutiao.ledger.add"(input, ctx) {
    return toutiao.ledgerAddCommand({
      ...input,
      cardPath: ctx.inside(input.cardPath),
      ledgerPath: ctx.inside(input.ledgerPath),
      ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
    });
  },
  async "toutiao.ledger.status"(input, ctx) {
    return toutiao.ledgerStatusCommand({
      ...input,
      ledgerPath: ctx.inside(input.ledgerPath),
      ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
    });
  },
  async "toutiao.metrics.import"(input, ctx) {
    return toutiao.metricsImportCommand({
      ...input,
      ledgerPath: ctx.inside(input.ledgerPath),
      ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
    });
  },
};

const PROFILES: { [K in Group<"profiles">]: Handler<K> } = {
  "profiles.list": (input, ctx) => PROFILE_HANDLERS["profiles.list"](input, ctx.profiles, ctx.clock.now),
  "profiles.detail": (input, ctx) => PROFILE_HANDLERS["profiles.detail"](input, ctx.profiles, ctx.clock.now),
  "profiles.method": (input, ctx) => PROFILE_HANDLERS["profiles.method"](input, ctx.profiles, ctx.clock.now),
  "profiles.use": (input, ctx) => PROFILE_HANDLERS["profiles.use"](input, ctx.profiles, ctx.clock.now),
  "profiles.create": (input, ctx) => PROFILE_HANDLERS["profiles.create"](input, ctx.profiles, ctx.clock.now),
  "profiles.save": (input, ctx) => PROFILE_HANDLERS["profiles.save"](input, ctx.profiles, ctx.clock.now),
  "profiles.reset": (input, ctx) => PROFILE_HANDLERS["profiles.reset"](input, ctx.profiles, ctx.clock.now),
  "profiles.rename": (input, ctx) => PROFILE_HANDLERS["profiles.rename"](input, ctx.profiles, ctx.clock.now),
  "profiles.delete": (input, ctx) => PROFILE_HANDLERS["profiles.delete"](input, ctx.profiles, ctx.clock.now),
};

const LIBRARY: { [K in Group<"library">]: Handler<K> } = {
  async "library.import"(input, ctx) {
    return fanqie.importLibrarySource(
      ctx.inside(input.libraryRoot),
      { id: safeId(input.id, "id"), title: input.title, content: input.content },
      ctx.locks,
    );
  },
  async "library.list"(input, ctx) {
    return { sources: await fanqie.listLibrarySources(ctx.inside(input.libraryRoot)) };
  },
  async "library.cards"(input, ctx) {
    const { cards, report } = await fanqie.readLibraryCards(ctx.inside(input.libraryRoot), input.sourceId);
    return { cards, ...(report !== undefined ? { report } : {}) };
  },
  async "library.dissect"(input, ctx) {
    const libraryRoot = ctx.inside(input.libraryRoot);
    const detail = await ctx.workflow.startAndWait({ mode: "fanqie", path: libraryRoot }, "library.dissect", {
      sourceId: input.sourceId,
      title: input.title,
      ...(input.sourcePath ? { sourcePath: ctx.inside(input.sourcePath) } : {}),
    });
    if (detail.state !== "awaiting-author") {
      const error = detail.error ?? { code: "run.interrupted" as const, message: `拆书未完成（${detail.state}）` };
      throw new AppError(error.code, error.message, { runId: detail.id, state: detail.state });
    }
    const { cards, report } = await fanqie.readLibraryCards(libraryRoot, input.sourceId);
    return {
      sourceId: input.sourceId,
      title: input.title,
      cardCount: cards.length,
      summary: (report ?? "").split("\n").find((line) => line.trim()) ?? "",
    };
  },
};

const HANDLERS: { [K in WorkbenchCommand]: Handler<K> } = { ...FANQIE, ...TOUTIAO, ...PROFILES, ...LIBRARY };

/** 已知命令 id 的运行时判定（IPC 边界解析用）。 */
export function isWorkbenchCommand(value: unknown): value is WorkbenchCommand {
  return typeof value === "string" && Object.hasOwn(HANDLERS, value);
}

async function run<K extends WorkbenchCommand>(command: K, raw: unknown, ctx: CommandCtx): Promise<CommandResult<K>> {
  const parse: Parser<CommandInput<K>> = INPUTS[command];
  const handler: Handler<K> = HANDLERS[command];
  return handler(parse(raw, "$input"), ctx);
}

export async function dispatchWorkbenchCommand(call: WorkbenchCall, ctx: CommandCtx): Promise<CommandResult<WorkbenchCommand>> {
  if (!isWorkbenchCommand(call.command)) {
    throw new AppError("input.invalid", `未知命令：${String(call.command)}`, { command: String(call.command) });
  }
  return run(call.command, call.input, ctx);
}
