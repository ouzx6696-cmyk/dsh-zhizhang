/**
 * 番茄写作助手工具：只读工具 + 发起流水线 / 打开对照。
 * 没有任何直接写正文、写候选或写设定集的工具（FR-40 / AC-50）；
 * 需要改稿时只能发起流水线，流水线把结果交付为候选稿，由作者采纳。
 */
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import { systemClock } from "@zhizhang/core/clock";
import { loadProfile, methodFor } from "@zhizhang/core/methods";
import { int, obj, opt, str, type Infer } from "@zhizhang/core/schema";
import { defineTool, type ToolCtx, type ToolDefinition } from "@zhizhang/core/tool";
import { createBibleStore } from "../bible/store.js";
import { listCandidates, readCandidate } from "../commands/candidate.js";
import { listChapters, readChapter } from "../commands/chapter.js";
import { readWorkMeta } from "../storage/work.js";
const DEFAULT_MAX_CHARS = 6000;
function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false };
}
const ChapterArgs = obj({
  chapterId: str({ min: 1 }),
  maxChars: opt(int({ min: 200, max: 40000 })),
});
const PositionArgs = obj({ position: int({ min: 1 }) });
const UpToArgs = obj({ upTo: int({ min: 1 }) });
const ChapterOnlyArgs = obj({ chapterId: opt(str({ min: 1 })) });
const CandidateArgs = obj({
  chapterId: str({ min: 1 }),
  candidateId: str({ min: 1 }),
  maxChars: opt(int({ min: 200, max: 40000 })),
});
const MethodArgs = obj({ stage: str({ min: 1 }) });
const NoArgs = obj({});
const stringProp = (description: string) => ({ type: "string", description });
const intProp = (description: string) => ({ type: "integer", description });
export function readAssistantTools(work: string): ToolDefinition[] {
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
    description: "读取设定集截至第 N 章的视图：人物/物件/设定、状态、伏笔线与知情表。",
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
        pending: await bible.pendingCount(work),
      };
    },
  });
  const bibleAuditTool = defineTool({
    name: "fanqie_bible_audit",
    description: "按代码规则巡检设定集（遗忘线、到期未兑现、知情越界、状态冲突），截至第 N 章。",
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
      return {
        profile: profile.id,
        stage: args.stage,
        text: clip(method.text, 8000).text,
        omitted: method.omitted,
      };
    },
  });
  return [
    listChaptersTool,
    workInfoTool,
    readChapterTool,
    bibleViewTool,
    bibleAuditTool,
    listCandidatesTool,
    readCandidateTool,
    readMethodTool,
  ].map((tool): ToolDefinition => tool);
}
