/**
 * T10 结构化连续性工具组：伏笔线/知识边界登记（规划期）、定稿核验、查询与笔记候选提取。
 * 全部工具在开关关闭时返回 continuity_disabled；写路径在作品锁内走 storage/continuity.ts。
 */
import { bridge, withTempFiles } from "../../forge.js";
import { FORESHADOW_BEAT_KINDS, KNOWLEDGE_LEVELS } from "../types.js";
import type {
  ChapterMeta,
  ContinuityCommitRecord,
  ForeshadowBeat,
  ForeshadowBeatKind,
  ForeshadowLine,
  HandoffRecord,
  KnowledgeHolder,
  KnowledgeItem,
  KnowledgeLevel,
} from "../types.js";
import { NovelError } from "../errors.js";
import {
  forgottenForeshadows,
  knowledgeBreachCandidates,
  beatReference,
} from "../domain/continuity.js";
import {
  listHandoffs,
  readCommits,
  readForeshadow,
  readHandoff,
  readKnowledge,
  saveCommits,
  saveForeshadow,
  saveHandoff,
  saveKnowledge,
} from "../storage/continuity.js";
import { listChapters, readChapter } from "../storage/chapters.js";
import { readWorkMeta } from "../storage/work-meta.js";
import { requireContinuityEnabled } from "../ports/continuity.js";
import { asObject, asString, asStringArray, boolArg, config, fail, openWork } from "./context.js";
import { B, I, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
import { withResourceLock } from "../storage/process-lock.js";
import { nowIso } from "../storage/primitives.js";

type ToolArgs = Record<string, unknown>;

function requireLineId(args: ToolArgs) {
  return asString(args, "line", { required: true });
}
function requirePosition(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    fail(`${label} 必须是从 1 开始的整数章号`);
  return value;
}
function optionalPosition(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined;
  return requirePosition(value, label);
}
function parseBeatKind(value: unknown): ForeshadowBeatKind {
  if (typeof value !== "string" || !(FORESHADOW_BEAT_KINDS as readonly string[]).includes(value))
    fail(`kind 只支持：${FORESHADOW_BEAT_KINDS.join("/")}`);
  return value as ForeshadowBeatKind;
}
function parseLevel(value: unknown): KnowledgeLevel {
  if (typeof value !== "string" || !(KNOWLEDGE_LEVELS as readonly string[]).includes(value))
    fail(`level 只支持：${KNOWLEDGE_LEVELS.join("/")}`);
  return value as KnowledgeLevel;
}
/** beats 参数（边界解析）：chapter/kind/note 必填，evidence 是可选短引句数组。 */
function parseBeats(args: ToolArgs): ForeshadowBeat[] | undefined {
  const raw = args.beats;
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) fail("beats 必须是数组");
  return raw.map((item) => {
    const beat = asObject(item, "beats[]");
    const evidenceRaw = beat.evidence;
    if (
      evidenceRaw !== undefined &&
      (!Array.isArray(evidenceRaw) || !evidenceRaw.every((e) => typeof e === "string" && e.trim()))
    )
      fail("beats[].evidence 必须是非空字符串数组（预期出现在正文里的短引句）");
    return {
      chapter: requirePosition(beat.chapter, "beats[].chapter"),
      kind: parseBeatKind(beat.kind),
      note: asString(beat as ToolArgs, "note", { required: true }),
      ...(Array.isArray(evidenceRaw)
        ? { evidence: (evidenceRaw as string[]).map((e) => e.trim()) }
        : {}),
    };
  });
}
/** holders 参数（边界解析）。 */
function parseHolders(args: ToolArgs): KnowledgeHolder[] | undefined {
  const raw = args.holders;
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) fail("holders 必须是非空数组");
  return raw.map((item) => {
    const holder = asObject(item, "holders[]");
    const who = asString(holder as ToolArgs, "who", { required: true });
    const source = asString(holder as ToolArgs, "source");
    const evidence = asString(holder as ToolArgs, "evidence");
    return {
      who,
      level: parseLevel(holder.level),
      since: requirePosition(holder.since, "holders[].since"),
      ...(source ? { source } : {}),
      ...(evidence ? { evidence } : {}),
    };
  });
}

function resolveChapterRef(chapters: ChapterMeta[], ref: string): ChapterMeta | undefined {
  const t = ref.trim();
  if (/^\d+$/.test(t))
    return [...chapters]
      .sort((a, b) => a.position - b.position)
      .find((c) => c.position === Number(t));
  return chapters.find((c) => c.id === t || c.title === t);
}

const foreshadowSet = defineTool({
  name: "fanqie_foreshadow_set",
  description:
    "登记或更新伏笔线（规划期）：线 id/title/seed、计划埋设与回收章号、beats（每线每章至多一笔，含预期正文引句 evidence）。status 不在此设置：由 fanqie_continuity_commit 核验推进；已 committed 的线改动报错。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    line: S("线 id（新建或更新）"),
    title: S("线标题（新建必填）"),
    seed: S("一句话伏笔（新建必填）"),
    planned_plant: I("计划埋设章号（新建必填）"),
    planned_payoff: I("计划回收章号（新建必填）"),
    beats: {
      type: "array",
      description:
        "本线的笔列表：{chapter: 章号, kind: 埋设/强化/误导/部分揭示/揭示/兑现/余波, note: 一句话计划, evidence?: [预期正文短引句]}；同一 (线,章) 只允许一笔",
      items: {
        type: "object",
        properties: {
          chapter: { type: "integer", description: "章号（position）" },
          kind: { type: "string", enum: [...FORESHADOW_BEAT_KINDS], description: "笔类型" },
          note: { type: "string", description: "一句话计划" },
          evidence: {
            type: "array",
            description: "预期出现在正文里的短引句；commit 据此机械核验",
            items: { type: "string" },
          },
        },
        required: ["chapter", "kind", "note"],
        additionalProperties: false,
      },
    },
    replace_beats: B("true：用本次 beats 整体替换；默认按章合并（同章覆盖）"),
  },
  required: ["line"],
  async execute(args, exec) {
    requireContinuityEnabled();
    const lineId = requireLineId(args);
    const { dir } = await openWork(exec, args);
    const beats = parseBeats(args);
    return withResourceLock(dir, async () => {
      const file = await readForeshadow(dir);
      const existing = file.lines.find((l) => l.id === lineId);
      if (existing?.status === "committed")
        throw new NovelError(
          "foreshadow_committed",
          `线 ${lineId} 已 committed，不能改动；如确需调整请与作者确认后另建新线。`,
        );
      const title = asString(args, "title");
      const seed = asString(args, "seed");
      const plannedPlant = optionalPosition(args.planned_plant, "planned_plant");
      const plannedPayoff = optionalPosition(args.planned_payoff, "planned_payoff");
      if (
        !existing &&
        (!title || !seed || plannedPlant === undefined || plannedPayoff === undefined)
      )
        fail("新建线必填：line、title、seed、planned_plant、planned_payoff");
      const plant = plannedPlant ?? existing?.plannedPlant;
      const payoff = plannedPayoff ?? existing?.plannedPayoff;
      if (plant === undefined || payoff === undefined)
        fail(`线 ${lineId} 缺少计划章号；请显式传 planned_plant / planned_payoff`);
      if (plant > payoff) fail("planned_payoff 不能早于 planned_plant");
      let nextBeats: ForeshadowBeat[];
      if (beats && (boolArg(args, "replace_beats") === true || !existing)) nextBeats = beats;
      else if (beats) {
        const merged = new Map((existing?.beats ?? []).map((b) => [b.chapter, b]));
        for (const beat of beats) merged.set(beat.chapter, beat);
        nextBeats = [...merged.values()].sort((a, b) => a.chapter - b.chapter);
      } else nextBeats = existing?.beats ?? [];
      const chapterSeen = new Set<number>();
      for (const beat of nextBeats) {
        if (chapterSeen.has(beat.chapter))
          fail(`线 ${lineId} 在第 ${beat.chapter} 章有多笔；同一 (线,章) 只允许一笔`);
        chapterSeen.add(beat.chapter);
      }
      const now = nowIso();
      const line: ForeshadowLine = {
        id: lineId,
        title: title || existing?.title || lineId,
        seed: seed || existing?.seed || "",
        plannedPlant: plant,
        plannedPayoff: payoff,
        status: existing?.status ?? "planned",
        beats: nextBeats,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const lines = existing
        ? file.lines.map((l) => (l.id === lineId ? line : l))
        : [...file.lines, line];
      await saveForeshadow(dir, lines, file.revision);
      return [
        `已登记伏笔线 ${line.id}《${line.title}》（status=${line.status}）`,
        `- seed：${line.seed}`,
        `- 计划：第 ${line.plannedPlant} 章埋设 → 第 ${line.plannedPayoff} 章回收；beats ${line.beats.length} 笔`,
        line.beats
          .map(
            (b) =>
              `  · 第${b.chapter}章 ${b.kind}：${b.note}${b.evidence?.length ? `（evidence ${b.evidence.length} 句）` : "（无 evidence，commit 无法机械核验）"}`,
          )
          .join("\n"),
        `- 下一步：正文落稿后用 fanqie_continuity_commit(chapter) 核验推进（须作者确认）`,
      ]
        .filter(Boolean)
        .join("\n");
    });
  },
});

const knowledgeSet = defineTool({
  name: "fanqie_knowledge_set",
  description:
    "登记或更新知识边界条目：一条事实（fact）+ 各人物的知情状态（holders：who/level/since/来源/正文引句）。commit 按 since==本章 的知情状态并用 evidence 引句核验。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    id: S("知识条目 id（新建或更新）"),
    fact: S("一句话事实（新建必填）"),
    holders: {
      type: "array",
      description:
        "知情状态：{who: 人物/势力, level: 公开/知情/误认/不知, since: 自第几章起, source?: 来源, evidence?: 正文引句}；提供时整体替换",
      items: {
        type: "object",
        properties: {
          who: { type: "string", description: "人物/势力名" },
          level: { type: "string", enum: [...KNOWLEDGE_LEVELS], description: "知情程度" },
          since: { type: "integer", description: "该状态自第几章（position）起" },
          source: { type: "string", description: "来源" },
          evidence: { type: "string", description: "正文引句或章号" },
        },
        required: ["who", "level", "since"],
        additionalProperties: false,
      },
    },
  },
  required: ["id"],
  async execute(args, exec) {
    requireContinuityEnabled();
    const itemId = asString(args, "id", { required: true });
    const { dir } = await openWork(exec, args);
    const holders = parseHolders(args);
    return withResourceLock(dir, async () => {
      const file = await readKnowledge(dir);
      const existing = file.items.find((k) => k.id === itemId);
      const fact = asString(args, "fact");
      if (!existing && !fact) fail("新建知识条目必填：id、fact");
      if (!existing && !holders) fail("新建知识条目必填：holders（至少一条知情状态）");
      const now = nowIso();
      const item: KnowledgeItem = {
        id: itemId,
        fact: fact || existing?.fact || "",
        holders: holders ?? existing?.holders ?? [],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const items = existing
        ? file.items.map((k) => (k.id === itemId ? item : k))
        : [...file.items, item];
      await saveKnowledge(dir, items, file.revision);
      const holderText = item.holders.map((h) => `${h.who}:${h.level}@${h.since}`).join("、");
      return `已登记知识条目 ${item.id}：${item.fact}（holders：${holderText || "无"}）。commit 按 since==本章 的知情状态核验 evidence 引句。`;
    });
  },
});

interface BeatVerification {
  line: ForeshadowLine;
  beat: ForeshadowBeat;
  status: "confirmed" | "missing" | "conflict";
  quotes: string[];
  detail: string;
}
/** 机械核验一笔：全部 evidence 命中 → confirmed；全不命中 → missing；部分 → conflict。无 evidence 只能 missing。 */
function verifyBeat(line: ForeshadowLine, beat: ForeshadowBeat, body: string): BeatVerification {
  if (!beat.evidence?.length)
    return {
      line,
      beat,
      status: "missing",
      quotes: [],
      detail:
        "未提供 evidence 引句，无法机械核验；请用 fanqie_foreshadow_set 补 evidence 后重新 commit",
    };
  const quotes = beat.evidence.filter((e) => body.includes(e));
  const status =
    quotes.length === beat.evidence.length
      ? "confirmed"
      : quotes.length === 0
        ? "missing"
        : "conflict";
  const missing = beat.evidence.filter((e) => !body.includes(e));
  const detail =
    status === "confirmed"
      ? `引句命中：${quotes[0]}`
      : status === "missing"
        ? "正文未出现任何预期引句"
        : `部分命中（${quotes.join("、")}）；缺：${missing.join("、")}`;
  return { line, beat, status, quotes, detail };
}

const continuityCommit = defineTool({
  name: "fanqie_continuity_commit",
  description:
    "连续性核验落盘（定稿或批次末，须作者确认）：读本章当前正文全文为证据，核验计划在本章的 beats 与应推进的 knowledge（confirmed/missing/conflict + 正文引句）；confirmed 项写入 commits 并推进线 status、写 handoff/<章>.json。计划外的重要事实只列为 unplanned 候选，不新建条目。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("章节 id"),
    revision: S("核验绑定的正文 revision（作者确认时自动钉定当前版本）"),
    summary: S("章末交接 summary；缺省按核验结果生成"),
    must_carry: {
      type: "array",
      description: "下章必须带走的点；缺省由 confirmed beats 与 knowledge 生成",
      items: { type: "string" },
    },
    next_constraints: {
      type: "array",
      description: "下章约束；缺省为空",
      items: { type: "string" },
    },
    notes: S("备注，写入 commits 记录"),
  },
  required: ["chapter"],
  async execute(args, exec) {
    requireContinuityEnabled();
    const chapterId = asString(args, "chapter", { required: true });
    const { dir } = await openWork(exec, args);
    return withResourceLock(dir, async () => {
      const chapter = await readChapter(dir, chapterId);
      const boundRevision = asString(args, "revision");
      if (boundRevision !== undefined && boundRevision !== chapter.revision)
        throw new NovelError(
          "revision_conflict",
          `核验绑定 revision ${boundRevision} 与当前正文 ${chapter.revision} 不一致，请重读本章后重新 commit。`,
        );
      if (!chapter.body.trim()) fail("本章正文为空，无可核验证据；先落稿再 commit。");
      const position = chapter.position;
      const [foreshadow, knowledge, commits, existingHandoff] = await Promise.all([
        readForeshadow(dir),
        readKnowledge(dir),
        readCommits(dir),
        readHandoff(dir, chapterId),
      ]);
      const previous = commits.commits.find((v) => v.chapter === chapterId);
      if (previous?.revision === chapter.revision)
        return [
          `本章已在 revision ${chapter.revision} 核验过（at ${previous.at}）：`,
          `- beats：${previous.beats.join("、") || "无"}`,
          `- knowledge：${previous.knowledge.join("、") || "无"}`,
          `如需重核，请先修改正文产生新 revision。`,
        ].join("\n");
      // —— 计划内待核验项 ——
      const beatResults = foreshadow.lines
        .flatMap((line) =>
          line.beats.filter((b) => b.chapter === position).map((beat) => ({ line, beat })),
        )
        .map(({ line, beat }) => verifyBeat(line, beat, chapter.body));
      const plannedKnowledge = knowledge.items.flatMap((item) =>
        item.holders
          .filter((h) => h.level !== "不知" && h.since === position)
          .map((holder) => ({ item, holder })),
      );
      const knowledgeResults = plannedKnowledge.map(({ item, holder }) => {
        const evidence = holder.evidence?.trim() ?? "";
        const checkable = evidence.length >= 4 && !/^第?\d+章$/.test(evidence);
        const confirmed = checkable && chapter.body.includes(evidence);
        return {
          item,
          holder,
          status: (confirmed ? "confirmed" : "missing") as "confirmed" | "missing",
          detail: confirmed
            ? `正文命中引句：${evidence}`
            : checkable
              ? "正文未找到 evidence 引句"
              : "evidence 缺失或只是章号，无法机械核验；请补正文引句",
        };
      });
      // —— 计划外候选：只列出不落盘 ——
      const plannedKnowledgeIds = new Set(plannedKnowledge.map(({ item }) => item.id));
      const unplanned = knowledgeBreachCandidates(knowledge.items, [
        { position, body: chapter.body },
      ]).filter((v) => !plannedKnowledgeIds.has(v.knowledgeId));
      // —— 推进线状态（confirmed → written；核到兑现/揭示或 payoff 章 → committed；payoff 章缺证 → missed）——
      const linesAdvanced: Array<{ id: string; from: string; to: string }> = [];
      const nextLines = foreshadow.lines.map((line): ForeshadowLine => {
        const confirmedHere = beatResults.some(
          (r) => r.status === "confirmed" && r.line.id === line.id,
        );
        const payoffBeatHere = line.beats.some(
          (b) =>
            b.chapter === position &&
            (position === line.plannedPayoff || b.kind === "揭示" || b.kind === "兑现"),
        );
        const payoffMissingHere =
          position === line.plannedPayoff &&
          line.beats.some((b) => b.chapter === position) &&
          !confirmedHere;
        let status = line.status;
        if (confirmedHere && payoffBeatHere) status = "committed";
        else if (payoffMissingHere && line.status !== "committed") status = "missed";
        else if (confirmedHere && status === "planned") status = "written";
        if (status !== line.status) {
          linesAdvanced.push({ id: line.id, from: line.status, to: status });
          return { ...line, status, updatedAt: nowIso() };
        }
        return line;
      });
      const confirmedKnowledgeIds = knowledgeResults
        .filter((r) => r.status === "confirmed")
        .map((r) => r.item.id);
      // —— handoff ——
      const openLoops = [
        ...nextLines
          .filter((l) => l.status === "planned" || l.status === "written")
          .map((l) => `${l.id}《${l.title}》计划第 ${l.plannedPayoff} 章回收`),
        ...beatResults
          .filter((r) => r.status !== "confirmed")
          .map(
            (r) =>
              `${r.line.id} 第 ${position} 章 ${r.beat.kind} 未核验（${r.status}）：${r.beat.note}`,
          ),
      ];
      const mustCarry = asStringArray(args, "must_carry", { trim: false }) ?? [
        ...beatResults.filter((r) => r.status === "confirmed").map((r) => r.beat.note),
        ...knowledgeResults
          .filter((r) => r.status === "confirmed")
          .map((r) => `${r.holder.who} ${r.holder.level}：${r.item.fact}`),
      ];
      const confirmedCount = beatResults.filter((r) => r.status === "confirmed").length;
      const notes = asString(args, "notes");
      const record: ContinuityCommitRecord = {
        chapter: chapterId,
        revision: chapter.revision,
        at: nowIso(),
        beats: beatResults
          .filter((r) => r.status === "confirmed")
          .map((r) => beatReference(r.line.id, r.beat.chapter)),
        knowledge: confirmedKnowledgeIds,
        ...(notes ? { notes } : {}),
      };
      const summary =
        asString(args, "summary") ??
        `核验 beats ${confirmedCount}/${beatResults.length}、knowledge ${confirmedKnowledgeIds.length}/${knowledgeResults.length}；openLoops ${openLoops.length} 项。`;
      const handoffRecord: Omit<HandoffRecord, "revision"> = {
        chapter: chapterId,
        summary,
        mustCarry,
        nextConstraints: asStringArray(args, "next_constraints", { trim: false }) ?? [],
        openLoops,
        at: nowIso(),
      };
      if (linesAdvanced.length > 0) await saveForeshadow(dir, nextLines, foreshadow.revision);
      await saveHandoff(dir, handoffRecord, existingHandoff?.revision);
      await saveCommits(
        dir,
        [...commits.commits.filter((v) => v.chapter !== chapterId), record],
        commits.revision,
      );
      return JSON.stringify(
        {
          chapter: chapterId,
          revision: chapter.revision,
          beats: beatResults.map((r) => ({
            line: r.line.id,
            title: r.line.title,
            chapter: r.beat.chapter,
            kind: r.beat.kind,
            note: r.beat.note,
            status: r.status,
            quote: r.quotes[0],
            detail: r.detail,
          })),
          knowledge: knowledgeResults.map((r) => ({
            id: r.item.id,
            fact: r.item.fact,
            who: r.holder.who,
            level: r.holder.level,
            status: r.status,
            detail: r.detail,
          })),
          unplanned: unplanned.map((v) => ({
            knowledgeId: v.knowledgeId,
            fact: v.fact,
            who: v.who,
            chapter: v.chapter,
            quote: v.quote,
            hint: "计划外重要事实：请作者确认后用 fanqie_foreshadow_set / fanqie_knowledge_set 登记，或纳入下章规划；本次未写入。",
          })),
          handoff: {
            written: `continuity/handoff/${chapterId}.json`,
            summary,
            mustCarry,
            openLoops,
          },
          linesAdvanced,
          note: "只有 confirmed 项写入 commits 并推进线状态；missing/conflict 如实列出，不落盘。",
        },
        null,
        2,
      );
    });
  },
});

const continuityGet = defineTool({
  name: "fanqie_continuity_get",
  description:
    "读取结构化连续性数据：伏笔线、知识边界、章末交接、commits；可按线/章过滤，inspect=true 时跑巡检（被遗忘伏笔：plannedPayoff 已过未 commit；知情越界候选），只列候选不判定。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    line: S("只看某条线（线 id）"),
    chapter: S('只看某章：章 id / 标题 / 章号，如 "c003" 或 "3"'),
    inspect: B("跑巡检：被遗忘伏笔 + 知情越界候选"),
  },
  async execute(args, exec) {
    requireContinuityEnabled();
    const { dir, key } = await openWork(exec, args);
    const [foreshadow, knowledge, commits, handoffs] = await Promise.all([
      readForeshadow(dir),
      readKnowledge(dir),
      readCommits(dir),
      listHandoffs(dir),
    ]);
    const lineFilter = asString(args, "line");
    const chapterFilter = asString(args, "chapter");
    const lines = lineFilter
      ? foreshadow.lines.filter((l) => l.id === lineFilter)
      : foreshadow.lines;
    if (lineFilter && lines.length === 0) fail(`找不到线：${lineFilter}`);
    let chapterMeta: ChapterMeta | undefined;
    if (chapterFilter) {
      const meta = await readWorkMeta(dir);
      chapterMeta = resolveChapterRef(meta.chapters, chapterFilter);
      if (!chapterMeta) fail(`找不到章节：${chapterFilter}`);
    }
    const chapterCommits = chapterMeta
      ? commits.commits.filter((v) => v.chapter === chapterMeta.id)
      : commits.commits;
    const inspect = boolArg(args, "inspect") === true;
    let inspection: Record<string, unknown> | undefined;
    if (inspect) {
      const chapters = await listChapters(dir);
      const bodies = await Promise.all(
        chapters
          .filter((c) => c.wordCount > 0)
          .map(async (c) => ({ position: c.position, body: (await readChapter(dir, c.id)).body })),
      );
      const lastPosition = chapters.reduce((max, c) => Math.max(max, c.position), 0);
      inspection = {
        lastChapterPosition: lastPosition,
        forgottenForeshadow: forgottenForeshadows(lines, lastPosition).map((l) => ({
          id: l.id,
          title: l.title,
          status: l.status,
          plannedPlant: l.plannedPlant,
          plannedPayoff: l.plannedPayoff,
          seed: l.seed,
          hint: "plannedPayoff 已过仍未 commit；与作者确认后补核验或改线",
        })),
        knowledgeBreach: knowledgeBreachCandidates(knowledge.items, bodies),
      };
    }
    return JSON.stringify(
      {
        work: key,
        foreshadow: { revision: foreshadow.revision, lines },
        knowledge: { revision: knowledge.revision, items: knowledge.items },
        handoff: handoffs,
        commits: chapterCommits,
        ...(inspection ? { inspect: inspection } : {}),
      },
      null,
      2,
    );
  },
});

const continuityMigrate = defineTool({
  name: "fanqie_continuity_migrate",
  description:
    "从现有笔记提取候选（只输出清单，不写盘）：从根基 happened/threads/readerKnowledge 与最近 N 章正文抽取伏笔线/知识候选，逐条带来源；作者确认后用 fanqie_foreshadow_set / fanqie_knowledge_set 登记。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    recent: I("最近 N 章正文参与抽取，默认 5；0 表示只看根基字段"),
  },
  async execute(args, exec) {
    requireContinuityEnabled();
    const { dir, key } = await openWork(exec, args);
    const meta = await readWorkMeta(dir);
    const f = meta.foundation;
    const splitLines = (text: string) =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    const lineCandidates = splitLines(f.threads).map((seed) => ({
      title: seed.slice(0, 24),
      seed,
      source: "foundation.threads",
    }));
    const seen = new Set<string>();
    const knowledgeCandidates = [
      ...splitLines(f.readerKnowledge).map((fact) => ({
        fact,
        source: "foundation.readerKnowledge",
      })),
      ...splitLines(f.happened).map((fact) => ({ fact, source: "foundation.happened" })),
    ].filter((c) => {
      if (seen.has(c.fact)) return false;
      seen.add(c.fact);
      return true;
    });
    const recent = args.recent === undefined ? 5 : args.recent;
    if (typeof recent !== "number" || !Number.isInteger(recent) || recent < 0)
      fail("recent 必须是非负整数（0 表示只看根基字段）");
    let bodyCandidates: Array<Record<string, unknown>> = [];
    if (recent > 0) {
      const chapters = (await listChapters(dir))
        .filter((c) => c.wordCount > 0)
        .sort((a, b) => b.position - a.position)
        .slice(0, recent);
      if (chapters.length) {
        const bodies = await Promise.all(chapters.map(async (c) => readChapter(dir, c.id)));
        const files = bodies.map((c) => ({
          name: `第${String(c.position).padStart(3, "0")}章-${c.id}.md`,
          text: c.body,
        }));
        const r = await withTempFiles(files, (paths) =>
          bridge(config.python, ["continuity", ...paths], { signal: exec.signal }),
        );
        bodyCandidates = ((r.candidates ?? []) as Array<Record<string, unknown>>).map((c) => ({
          kind: c.kind,
          quote: c.context,
          chapter: String(Number(String(c.file ?? "").match(/第(\d+)章/)?.[1] ?? NaN)),
          source: "body",
        }));
      }
    }
    return JSON.stringify(
      {
        work: key,
        candidates: { lines: lineCandidates, knowledge: knowledgeCandidates },
        bodyCandidates,
        note: "只输出候选，不写盘；逐条作者确认后：线/笔 → fanqie_foreshadow_set，知识 → fanqie_knowledge_set。",
      },
      null,
      2,
    );
  },
});

export function continuityTools() {
  return [foreshadowSet, knowledgeSet, continuityCommit, continuityGet, continuityMigrate];
}
