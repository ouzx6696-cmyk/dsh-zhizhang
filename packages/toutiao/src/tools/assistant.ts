/**
 * 头条写作助手工具：读文章状态/立项卡/草稿/来源/台账/方法 + 发起文章流水线 / 打开文章视图。
 * 不提供任何写草稿、写交稿单或改状态的工具（FR-40 / AC-50）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { resolveResourcePath, readJson, readTextIfExists } from "@zhizhang/core/fs";
import { loadProfile, methodFor } from "@zhizhang/core/methods";
import type { ModeTarget } from "@zhizhang/core/pipeline";
import { int, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";
import {
  assertWorkspaceWritable,
  defineTool,
  type Role,
  type ToolCtx,
  type ToolDefinition,
} from "@zhizhang/core/tool";
import { ledgerShowCommand } from "../commands/ledger.js";
import { ArticleMetaSchema } from "../storage/articles.js";

const DEFAULT_MAX_CHARS = 6000;

function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false };
}

async function readMeta(articleDir: string) {
  const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema);
  if (!meta) throw new AppError("input.not_found", `未找到文章：${articleDir}`, { articleDir });
  return meta;
}

async function listDrafts(articleDir: string): Promise<Array<{ file: string; mtimeMs: number }>> {
  const dir = path.join(articleDir, "drafts");
  const names = await fs.readdir(dir).catch(() => []);
  const out: Array<{ file: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const stat = await fs.stat(resolveResourcePath(articleDir, "drafts", name));
    out.push({ file: name, mtimeMs: stat.mtimeMs });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));
}

const NoArgs = obj({});
const DraftArgs = obj({ file: opt(str({ min: 1 })), maxChars: opt(int({ min: 200, max: 40000 })) });
const SourceArgs = obj({ sourceId: str({ min: 1 }), maxChars: opt(int({ min: 200, max: 40000 })) });
const LedgerArgs = obj({ last: opt(int({ min: 1, max: 50 })) });
const MethodArgs = obj({ stage: str({ min: 1 }) });
const StartArgs = obj({
  note: opt(str({ max: 2000 })),
  line: opt(str({ max: 200 })),
  draftCount: opt(int({ min: 1, max: 5 })),
});
const OpenArgs = obj({ view: lit("draft", "card", "delivery", "sources") });

const stringProp = (description: string) => ({ type: "string", description });
const intProp = (description: string) => ({ type: "integer", description });

export function toutiaoAssistantTools(role: Role, target: ModeTarget): ToolDefinition[] {
  if (role !== "assistant") return [];
  const articleDir = target.path;
  const toutiaoRoot = path.dirname(articleDir);

  const statusTool = defineTool({
    name: "toutiao_article_status",
    description: "读取文章元数据：状态、体裁、主驱动、选定标题、状态历史与已有草稿列表。",
    params: NoArgs,
    jsonSchema: { type: "object", properties: {} },
    roles: ["assistant"],
    async run() {
      const meta = await readMeta(articleDir);
      const drafts = await listDrafts(articleDir);
      const delivered = (await readTextIfExists(path.join(articleDir, "交稿单.md"))) !== undefined;
      return {
        id: meta.id,
        status: meta.status,
        genre: meta.genre,
        driver: meta.driver,
        chosenTitle: meta.chosenTitle ?? null,
        rulesVersion: meta.rulesVersion,
        history: meta.history,
        drafts: drafts.map((d) => d.file),
        delivered,
      };
    },
  });

  const cardTool = defineTool({
    name: "toutiao_read_card",
    description: "读取文章立项卡（主问题、核心事实、读者、体裁、内容线、主驱动等）。",
    params: NoArgs,
    jsonSchema: { type: "object", properties: {} },
    roles: ["assistant"],
    async run() {
      const raw = await readTextIfExists(path.join(articleDir, "card.json"));
      if (raw === undefined) throw new AppError("input.not_found", "这篇文章还没有立项卡");
      return { card: clip(raw, 8000).text };
    },
  });

  const draftTool = defineTool({
    name: "toutiao_read_draft",
    description: "只读读取文章草稿（缺省为最新一版），或指定草稿文件名。",
    params: DraftArgs,
    jsonSchema: {
      type: "object",
      properties: {
        file: stringProp("草稿文件名，例如 rev-001.md；省略取最新一版"),
        maxChars: intProp("最多返回的字数，缺省 6000"),
      },
    },
    roles: ["assistant"],
    async run(args: Infer<typeof DraftArgs>) {
      const drafts = await listDrafts(articleDir);
      const file = args.file ?? drafts[0]?.file;
      if (!file) {
        throw new AppError("input.not_found", "这篇文章还没有草稿");
      }
      const text = await readTextIfExists(resolveResourcePath(articleDir, "drafts", file));
      if (text === undefined)
        throw new AppError("input.not_found", `未找到草稿：${file}`, { file });
      const body = clip(text, args.maxChars ?? DEFAULT_MAX_CHARS);
      return { file, text: body.text, truncated: body.truncated };
    },
  });

  const sourcesTool = defineTool({
    name: "toutiao_list_sources",
    description: "列出文章已登记的来源（id、类型、哈希、登记时间）。",
    params: NoArgs,
    jsonSchema: { type: "object", properties: {} },
    roles: ["assistant"],
    async run() {
      const dir = path.join(articleDir, "sources");
      const names = (await fs.readdir(dir).catch(() => []))
        .filter((n) => n.endsWith(".json"))
        .sort();
      const sources: unknown[] = [];
      for (const name of names) {
        const raw = await readTextIfExists(resolveResourcePath(articleDir, "sources", name));
        if (raw === undefined) continue;
        try {
          sources.push(JSON.parse(raw));
        } catch {
          throw new AppError("storage.format_unsupported", `来源登记无法解析：${name}`, { name });
        }
      }
      return { sources };
    },
  });

  const readSourceTool = defineTool({
    name: "toutiao_read_source",
    description: "只读读取一条来源的正文快照。",
    params: SourceArgs,
    jsonSchema: {
      type: "object",
      properties: { sourceId: stringProp("来源 id"), maxChars: intProp("最多返回的字数") },
      required: ["sourceId"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof SourceArgs>) {
      const text = await readTextIfExists(
        resolveResourcePath(articleDir, "sources", `${args.sourceId}.txt`),
      );
      if (text === undefined) {
        throw new AppError("input.not_found", `未找到来源：${args.sourceId}`, {
          sourceId: args.sourceId,
        });
      }
      const body = clip(text, args.maxChars ?? DEFAULT_MAX_CHARS);
      return { sourceId: args.sourceId, text: body.text, truncated: body.truncated };
    },
  });

  const ledgerTool = defineTool({
    name: "toutiao_read_ledger",
    description: "读取发稿台账最近若干行（标题、母体、开头式、结尾式、状态），用于避免重复。",
    params: LedgerArgs,
    jsonSchema: {
      type: "object",
      properties: { last: intProp("最近几行，缺省 10") },
    },
    roles: ["assistant"],
    async run(args: Infer<typeof LedgerArgs>) {
      const scriptsDir = process.env.ZHIZHANG_TOUTIAO_SCRIPTS_DIR?.trim();
      return ledgerShowCommand({
        ledgerPath: path.join(toutiaoRoot, "ledger.csv"),
        last: args.last ?? 10,
        ...(scriptsDir ? { scriptsDir } : {}),
      });
    },
  });

  const feedbackTool = defineTool({
    name: "toutiao_read_feedback",
    description: "读取作者积累的改稿反馈（头条/feedback.md）。",
    params: NoArgs,
    jsonSchema: { type: "object", properties: {} },
    roles: ["assistant"],
    async run() {
      const text = (await readTextIfExists(path.join(toutiaoRoot, "feedback.md"))) ?? "";
      return { text: clip(text, 6000).text };
    },
  });

  const methodTool = defineTool({
    name: "toutiao_read_method",
    description:
      "查阅当前方法方案中某个阶段取用的方法原文（例如 card、title、draft、review、qa）。",
    params: MethodArgs,
    jsonSchema: {
      type: "object",
      properties: { stage: stringProp("阶段 id") },
      required: ["stage"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof MethodArgs>, ctx: ToolCtx) {
      if (!ctx.profileRoots) throw new AppError("input.not_found", "未配置方法方案目录");
      const profile = await loadProfile("toutiao", "default", ctx.profileRoots);
      const method = methodFor(profile, args.stage);
      if (!method.text) {
        throw new AppError("input.not_found", `方案中没有阶段 ${args.stage} 的方法`, {
          stage: args.stage,
          stages: Object.keys(profile.stageMap),
        });
      }
      return { stage: args.stage, text: clip(method.text, 8000).text, omitted: method.omitted };
    },
  });

  const startTool = defineTool({
    name: "toutiao_start_article",
    description:
      "发起头条文章流水线（来源→立项卡→标题→蓝图→成稿→事实链→红笔→精修→质检），草稿只增不改，交稿须作者验收。",
    params: StartArgs,
    jsonSchema: {
      type: "object",
      properties: {
        note: stringProp("作者要求"),
        line: stringProp("内容线"),
        draftCount: intProp("起稿份数 1–5"),
      },
    },
    roles: ["assistant"],
    async run(args: Infer<typeof StartArgs>, ctx: ToolCtx) {
      assertWorkspaceWritable(ctx.readonly);
      if (!ctx.host) throw new AppError("gate.denied", "当前会话不能发起流水线");
      const meta = await readMeta(articleDir);
      return ctx.host.startPipeline("toutiao.article", {
        articleId: meta.id,
        genre: meta.genre,
        driver: meta.driver,
        ...(args.note ? { note: args.note } : {}),
        ...(args.line ? { line: args.line } : {}),
        ...(args.draftCount ? { draftCount: args.draftCount } : {}),
      });
    },
  });

  const openTool = defineTool({
    name: "toutiao_open_article",
    description: "在中栏打开文章的草稿、立项卡、交稿单或来源视图。",
    params: OpenArgs,
    jsonSchema: {
      type: "object",
      properties: { view: { type: "string", enum: ["draft", "card", "delivery", "sources"] } },
      required: ["view"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof OpenArgs>, ctx: ToolCtx) {
      if (!ctx.host) throw new AppError("gate.denied", "当前会话不能切换视图");
      const meta = await readMeta(articleDir);
      ctx.host.navigate({ article: meta.id, view: args.view });
      return { opened: true };
    },
  });

  const tools = [
    statusTool,
    cardTool,
    draftTool,
    sourcesTool,
    readSourceTool,
    ledgerTool,
    feedbackTool,
    methodTool,
    startTool,
    openTool,
  ];
  return tools.map((tool): ToolDefinition => tool);
}
