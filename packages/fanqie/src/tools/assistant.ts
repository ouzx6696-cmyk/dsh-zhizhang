/**
 * 番茄写作助手工具：只读工具 + 发起流水线 / 打开对照。
 * 没有任何直接写正文、写候选或写圣经的工具（FR-40 / AC-50）；
 * 需要改稿时只能发起流水线，流水线把结果交付为候选稿，由作者采纳。
 */
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import { systemClock } from "@zhizhang/core/clock";
import { loadProfile, methodFor } from "@zhizhang/core/methods";
import { arr, int, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";
import {
  assertWorkspaceWritable,
  defineTool,
  type ToolCtx,
  type ToolDefinition,
} from "@zhizhang/core/tool";
import type { ModeTarget } from "@zhizhang/core/pipeline";
import type { Role } from "@zhizhang/core/tool";
import { createBibleStore } from "../bible/store.js";
import { listCandidates, readCandidate } from "../commands/candidate.js";
import { listChapters, readChapter } from "../commands/chapter.js";
import { readWorkMeta } from "../storage/work.js";

const DEFAULT_MAX_CHARS = 6000;

function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

function requireHost(ctx: ToolCtx) {
  if (!ctx.host) {
    throw new AppError("gate.denied", "当前会话不能发起流水线");
  }
  return ctx.host;
}

const ChapterArgs = obj({ chapterId: str({ min: 1 }), maxChars: opt(int({ min: 200, max: 40000 })) });
const PositionArgs = obj({ position: int({ min: 1 }) });
const UpToArgs = obj({ upTo: int({ min: 1 }) });
const ChapterOnlyArgs = obj({ chapterId: opt(str({ min: 1 })) });
const CandidateArgs = obj({
  chapterId: str({ min: 1 }),
  candidateId: str({ min: 1 }),
  maxChars: opt(int({ min: 200, max: 40000 })),
});
const MethodArgs = obj({ stage: str({ min: 1 }) });
const StartChapterArgs = obj({
  chapterId: str({ min: 1 }),
  note: opt(str({ max: 2000 })),
  grade: opt(lit("economy", "standard", "premium")),
});
const StartReviewArgs = obj({ chapterId: str({ min: 1 }), note: opt(str({ max: 2000 })) });
const StartReviseArgs = obj({
  chapterId: str({ min: 1 }),
  note: str({ min: 1, max: 2000 }),
  issues: opt(
    arr(
      obj({
        kind: lit("continuity", "reader"),
        quote: str(),
        issue: str({ min: 1 }),
        fix: str({ min: 1 }),
      }),
      { max: 20 },
    ),
  ),
});
const StartHealthArgs = obj({ upToChapter: int({ min: 1 }) });
const NoArgs = obj({});

const stringProp = (description: string) => ({ type: "string", description });
const intProp = (description: string) => ({ type: "integer", description });

export function fanqieAssistantTools(role: Role, target: ModeTarget): ToolDefinition[] {
  if (role !== "assistant") return [];
  const work = target.path;
  const lock = createLockService(systemClock);
  const bible = createBibleStore(lock);

  const listChaptersTool = defineTool({
    name: "fanqie_list_chapters",
    description: "列出本书全部章节：序号、标题、状态、字数与版本。",
    params: NoArgs,
    jsonSchema: { type: "object", properties: {} },
    roles: ["assistant"],
    async run() {
      return { chapters: await listChapters(work) };
    },
  });

  const workInfoTool = defineTool({
    name: "fanqie_work_info",
    description: "读取作品信息：书名、档位、方法方案、作品设置与卷章结构。",
    params: NoArgs,
    jsonSchema: { type: "object", properties: {} },
    roles: ["assistant"],
    async run() {
      const meta = await readWorkMeta(work);
      const structureRaw = await readTextIfExists(path.join(work, "plan", "structure.json"));
      const cardRaw = await readTextIfExists(path.join(work, "plan", "card.json"));
      return {
        title: meta.title,
        grade: meta.grade,
        profile: meta.profile,
        settings: meta.settings,
        structure: structureRaw ? clip(structureRaw, 4000).text : "[]",
        card: cardRaw ? clip(cardRaw, 4000).text : null,
      };
    },
  });

  const readChapterTool = defineTool({
    name: "fanqie_read_chapter",
    description: "只读读取指定章节的正文、状态、章纲与最近一次审读结论。",
    params: ChapterArgs,
    jsonSchema: {
      type: "object",
      properties: {
        chapterId: stringProp("章节 id，例如 ch-003"),
        maxChars: intProp("正文最多返回的字数，缺省 6000"),
      },
      required: ["chapterId"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof ChapterArgs>) {
      const doc = await readChapter(work, args.chapterId);
      const body = clip(doc.body, args.maxChars ?? DEFAULT_MAX_CHARS);
      return {
        id: doc.meta.id,
        title: doc.meta.title,
        status: doc.meta.status,
        revision: doc.meta.revision,
        outline: doc.meta.outline ?? null,
        review: doc.meta.review ?? null,
        body: body.text,
        truncated: body.truncated,
      };
    },
  });

  const bibleViewTool = defineTool({
    name: "fanqie_bible_view",
    description: "读取故事圣经截至第 N 章的视图：人物/物件/设定、状态、伏笔线与知情表。",
    params: PositionArgs,
    jsonSchema: {
      type: "object",
      properties: { position: intProp("章序号（第 N 章）") },
      required: ["position"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof PositionArgs>) {
      const all = await bible.read(work);
      const view = bible.asOf(all, args.position);
      return {
        position: view.position,
        entities: view.entities.map((e) => ({
          id: e.id,
          kind: e.kind,
          name: e.name,
          aliases: e.aliases,
          summary: e.summary,
        })),
        states: view.states.map((s) => ({
          entity: s.entity,
          field: s.field,
          value: s.value,
          since: s.since,
          until: s.until ?? null,
          status: s.status,
        })),
        threads: view.threads.map((t) => ({
          id: t.id,
          title: t.title,
          kind: t.kind,
          opened: t.opened,
          plannedPayoff: t.plannedPayoff ?? null,
          status: t.status,
        })),
        knowledge: view.knowledge.map((k) => ({
          fact: k.fact,
          holder: k.holder,
          level: k.level,
          since: k.since,
        })),
        pending: all.pending.length,
      };
    },
  });

  const bibleAuditTool = defineTool({
    name: "fanqie_bible_audit",
    description: "按代码规则巡检故事圣经（遗忘线、到期未兑现、知情越界、状态冲突），截至第 N 章。",
    params: UpToArgs,
    jsonSchema: {
      type: "object",
      properties: { upTo: intProp("巡检截至的章序号") },
      required: ["upTo"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof UpToArgs>) {
      const all = await bible.read(work);
      return { findings: bible.audit(all, args.upTo) };
    },
  });

  const listCandidatesTool = defineTool({
    name: "fanqie_list_candidates",
    description: "列出候选稿（可限定章节）：候选 id、标题、字数、是否已采纳或拒绝。",
    params: ChapterOnlyArgs,
    jsonSchema: {
      type: "object",
      properties: { chapterId: stringProp("只列这一章的候选，可省略") },
    },
    roles: ["assistant"],
    async run(args: Infer<typeof ChapterOnlyArgs>) {
      return { candidates: await listCandidates(work, args.chapterId) };
    },
  });

  const readCandidateTool = defineTool({
    name: "fanqie_read_candidate",
    description: "只读读取一份候选稿的正文。",
    params: CandidateArgs,
    jsonSchema: {
      type: "object",
      properties: {
        chapterId: stringProp("章节 id"),
        candidateId: stringProp("候选 id"),
        maxChars: intProp("最多返回的字数，缺省 6000"),
      },
      required: ["chapterId", "candidateId"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof CandidateArgs>) {
      const cand = await readCandidate(work, args.chapterId, args.candidateId);
      const body = clip(cand.body, args.maxChars ?? DEFAULT_MAX_CHARS);
      return { ...cand, body: body.text, truncated: body.truncated };
    },
  });

  const readMethodTool = defineTool({
    name: "fanqie_read_method",
    description: "查阅当前方法方案中某个阶段取用的方法原文（例如 draft、review、revise、beats）。",
    params: MethodArgs,
    jsonSchema: {
      type: "object",
      properties: { stage: stringProp("阶段 id") },
      required: ["stage"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof MethodArgs>, ctx: ToolCtx) {
      if (!ctx.profileRoots) throw new AppError("input.not_found", "未配置方法方案目录");
      const meta = await readWorkMeta(work);
      const profile = await loadProfile("fanqie", meta.profile, ctx.profileRoots);
      const method = methodFor(profile, args.stage);
      if (!method.text) {
        throw new AppError("input.not_found", `方案中没有阶段 ${args.stage} 的方法`, {
          stage: args.stage,
          stages: Object.keys(profile.stageMap),
        });
      }
      return { profile: profile.id, stage: args.stage, text: clip(method.text, 8000).text, omitted: method.omitted };
    },
  });

  const startChapterTool = defineTool({
    name: "fanqie_start_chapter",
    description: "发起章节流水线（起稿→择优→连续性检查→审读→修订），结果交付为候选稿，不改正文。",
    params: StartChapterArgs,
    jsonSchema: {
      type: "object",
      properties: {
        chapterId: stringProp("要写的章节 id"),
        note: stringProp("作者的写作要求"),
        grade: { type: "string", enum: ["economy", "standard", "premium"] },
      },
      required: ["chapterId"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof StartChapterArgs>, ctx: ToolCtx) {
      assertWorkspaceWritable(ctx.readonly);
      const request = {
        chapterId: args.chapterId,
        ...(args.note ? { note: args.note } : {}),
        ...(args.grade ? { grade: args.grade } : {}),
      };
      return requireHost(ctx).startPipeline("fanqie.chapter", request);
    },
  });

  const startReviewTool = defineTool({
    name: "fanqie_start_review",
    description: "派独立编辑审读指定章节（发起审读流水线），审读报告交付到候选目录。",
    params: StartReviewArgs,
    jsonSchema: {
      type: "object",
      properties: { chapterId: stringProp("章节 id"), note: stringProp("审读侧重点") },
      required: ["chapterId"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof StartReviewArgs>, ctx: ToolCtx) {
      assertWorkspaceWritable(ctx.readonly);
      return requireHost(ctx).startPipeline("fanqie.review", {
        chapterId: args.chapterId,
        ...(args.note ? { note: args.note } : {}),
      });
    },
  });

  const startReviseTool = defineTool({
    name: "fanqie_start_revise",
    description: "按作者意见发起定向修订流水线；修订稿交付为候选稿，由作者对照采纳。",
    params: StartReviseArgs,
    jsonSchema: {
      type: "object",
      properties: {
        chapterId: stringProp("章节 id"),
        note: stringProp("修改要求"),
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["continuity", "reader"] },
              quote: { type: "string" },
              issue: { type: "string" },
              fix: { type: "string" },
            },
            required: ["kind", "quote", "issue", "fix"],
          },
        },
      },
      required: ["chapterId", "note"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof StartReviseArgs>, ctx: ToolCtx) {
      assertWorkspaceWritable(ctx.readonly);
      return requireHost(ctx).startPipeline("fanqie.revise", {
        chapterId: args.chapterId,
        note: args.note,
        ...(args.issues ? { issues: args.issues } : {}),
      });
    },
  });

  const startHealthTool = defineTool({
    name: "fanqie_start_health",
    description: "发起全书体检流水线（截至第 N 章），报告写入 plan/health。",
    params: StartHealthArgs,
    jsonSchema: {
      type: "object",
      properties: { upToChapter: intProp("体检截至的章序号") },
      required: ["upToChapter"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof StartHealthArgs>, ctx: ToolCtx) {
      assertWorkspaceWritable(ctx.readonly);
      return requireHost(ctx).startPipeline("fanqie.health", { upToChapter: args.upToChapter });
    },
  });

  const openCompareTool = defineTool({
    name: "fanqie_open_compare",
    description: "在中栏打开正文与候选稿的对照视图，供作者决定是否采纳。",
    params: obj({ chapterId: str({ min: 1 }), candidateId: str({ min: 1 }) }),
    jsonSchema: {
      type: "object",
      properties: { chapterId: stringProp("章节 id"), candidateId: stringProp("候选 id") },
      required: ["chapterId", "candidateId"],
    },
    roles: ["assistant"],
    async run(args: { chapterId: string; candidateId: string }, ctx: ToolCtx) {
      await readCandidate(work, args.chapterId, args.candidateId);
      requireHost(ctx).navigate({
        chapter: args.chapterId,
        candidate: args.candidateId,
        source: "split",
      });
      return { opened: true };
    },
  });

  const tools = [
    listChaptersTool,
    workInfoTool,
    readChapterTool,
    bibleViewTool,
    bibleAuditTool,
    listCandidatesTool,
    readCandidateTool,
    readMethodTool,
    startChapterTool,
    startReviewTool,
    startReviseTool,
    startHealthTool,
    openCompareTool,
  ];
  return tools.map((tool): ToolDefinition => tool);
}
