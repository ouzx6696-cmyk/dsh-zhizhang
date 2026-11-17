import {
  defineTool,
  assertWorkspaceWritable,
  type ToolCtx,
  type ToolDefinition,
} from "@zhizhang/core/tool";
import { arr, int, lit, obj, opt, str } from "@zhizhang/core/schema";
import { AppError } from "@zhizhang/core/errors";
import { createLockService } from "@zhizhang/core/lock";
import { systemClock } from "@zhizhang/core/clock";
import { createBibleStore } from "../bible/store.js";
import { AnyOpSchema, PendingBatchSchema } from "../bible/ops-schema.js";
import { EntityKindSchema } from "../bible/schema.js";
import { createOutlineStore, readOutline, nodesOf, derivePositions } from "../outline/index.js";
import { auditWork } from "../bible/audit-work.js";
import { createIdSource } from "@zhizhang/core/id";
import { atomicWrite, resolveResourcePath } from "@zhizhang/core/fs";
import type { AnyOp } from "../bible/types.js";

function host(ctx: ToolCtx) {
  if (!ctx.host) throw new AppError("gate.denied", "宿主不可用");
  return ctx.host;
}
function limited(value: object): object {
  if (JSON.stringify(value).length <= 4000) return value;
  return {
    text: JSON.stringify(value).slice(0, 3900),
    truncated: true,
    note: "已截断，用更窄的参数再查",
  };
}
const stringProp = { type: "string" },
  numberProp = { type: "integer" };
export function planAssistantTools(work: string): ToolDefinition[] {
  const lock = createLockService(systemClock),
    bible = createBibleStore(lock),
    outlines = createOutlineStore(lock);
  const tools = [
    defineTool({
      name: "fanqie_outline_tree",
      description: "读取大纲树与派生章序",
      params: obj({ volume: opt(str()), depth: opt(int({ min: 1, max: 3 })) }),
      jsonSchema: { type: "object", properties: { volume: stringProp, depth: numberProp } },
      roles: ["assistant"],
      async run({ volume, depth }) {
        const data = await outlines.get(work);
        let nodes = data.nodes;
        if (volume) {
          const ids = new Set([volume]);
          nodes = nodes.filter((node) => {
            if (node.id === volume || (node.parent && ids.has(node.parent))) {
              ids.add(node.id);
              return true;
            }
            return false;
          });
        }
        return limited({
          nodes: nodes.filter(
            (node) => (node.level === "volume" ? 1 : node.level === "act" ? 2 : 3) <= (depth ?? 3),
          ),
        });
      },
    }),
    defineTool({
      name: "fanqie_outline_node",
      description: "按标识或位置读取计划节点，引用解析成名称",
      params: obj({ id: opt(str()), position: opt(int({ min: 1 })) }),
      jsonSchema: { type: "object", properties: { id: stringProp, position: numberProp } },
      roles: ["assistant"],
      async run({ id, position }) {
        const data = await readOutline(work),
          positions = derivePositions(data, []).plans;
        const value = nodesOf(data).find(({ node }) =>
          id ? node.id === id : positions.get(node.id) === position,
        );
        if (!value) throw new AppError("input.not_found", "计划节点不存在");
        const lib = await bible.read(work);
        return limited({
          node: value.node,
          refs: Object.fromEntries([
            ...lib.entities.map((entity) => [entity.id, entity.name]),
            ...lib.threads.map((thread) => [thread.id, thread.title]),
          ]),
        });
      },
    }),
    defineTool({
      name: "fanqie_bible_search",
      description: "按关键词和章节位置查询设定库",
      params: obj({
        query: opt(str({ max: 100 })),
        kind: opt(EntityKindSchema),
        position: opt(int({ min: 1 })),
        limit: opt(int({ min: 1, max: 30 })),
      }),
      jsonSchema: {
        type: "object",
        properties: {
          query: stringProp,
          kind: stringProp,
          position: numberProp,
          limit: numberProp,
        },
      },
      roles: ["assistant"],
      run: async ({ query, kind, position, limit }) =>
        limited(
          await bible.query(work, { q: query, kind }, position, { offset: 0, limit: limit ?? 30 }),
        ),
    }),
    defineTool({
      name: "fanqie_bible_entity",
      description: "读取实体、动态状态与关系",
      params: obj({ id: str({ min: 1 }), position: opt(int({ min: 1 })) }),
      jsonSchema: {
        type: "object",
        properties: { id: stringProp, position: numberProp },
        required: ["id"],
      },
      roles: ["assistant"],
      async run({ id, position }) {
        const value = await bible.entity(work, id, position);
        return limited({ ...value, timeline: value.states });
      },
    }),
    defineTool({
      name: "fanqie_threads",
      description: "读取伏笔及到期状态",
      params: obj({
        position: opt(int({ min: 1 })),
        status: opt(lit("open", "paid", "dropped")),
        dueWithin: opt(int({ min: 0, max: 100 })),
      }),
      jsonSchema: {
        type: "object",
        properties: { position: numberProp, status: stringProp, dueWithin: numberProp },
      },
      roles: ["assistant"],
      async run({ position, status, dueWithin }) {
        const p = position ?? 1;
        return limited({
          threads: bible
            .asOf(await bible.read(work), p)
            .threads.filter((thread) => !status || thread.status === status)
            .map((thread) => ({
              ...thread,
              overdue:
                thread.status === "open" && (thread.dueBy ?? thread.plannedPayoff ?? Infinity) < p,
              due: (thread.dueBy ?? thread.plannedPayoff ?? Infinity) <= p + (dueWithin ?? 3),
            })),
        });
      },
    }),
    defineTool({
      name: "fanqie_facts_recent",
      description: "读取最近章节的已确认事实",
      params: obj({
        position: int({ min: 1 }),
        window: opt(int({ min: 0, max: 20 })),
        entity: opt(str()),
      }),
      jsonSchema: {
        type: "object",
        properties: { position: numberProp, window: numberProp, entity: stringProp },
        required: ["position"],
      },
      roles: ["assistant"],
      async run({ position, window, entity }) {
        return limited({
          facts: bible
            .asOf(await bible.read(work), position, await bible.ledgers(work), window ?? 5)
            .recentFacts.filter((fact) => !entity || fact.entities.includes(entity)),
        });
      },
    }),
    defineTool({
      name: "fanqie_check",
      description: "零费用检查计划与设定的一致性",
      params: obj({ upTo: int({ min: 1 }) }),
      jsonSchema: { type: "object", properties: { upTo: numberProp }, required: ["upTo"] },
      roles: ["assistant"],
      run: async ({ upTo }) => limited({ findings: await auditWork(work, upTo) }),
    }),
    defineTool({
      name: "fanqie_propose",
      description: "仅生成待确认提案，不写设定或正文；请提示作者去待确认页决定",
      params: obj({ ops: arr(AnyOpSchema, { max: 20 }), reason: str({ min: 1, max: 200 }) }),
      jsonSchema: {
        type: "object",
        properties: {
          ops: { type: "array", items: { type: "object" }, maxItems: 20 },
          reason: stringProp,
        },
        required: ["ops", "reason"],
      },
      roles: ["assistant"],
      async run({ ops, reason }: { ops: AnyOp[]; reason: string }, ctx) {
        assertWorkspaceWritable(ctx.readonly);
        const id = createIdSource().next("asst");
        const batch = PendingBatchSchema({
          format: "zhizhang/1.3",
          id,
          source: "assistant",
          reason,
          created: systemClock.iso(),
          status: "open",
          commits: [],
          items: ops.map((op: AnyOp) => ({
            id: createIdSource().next("p"),
            op,
            change: "new",
            group: "assistant",
            dependsOn: [],
            notes: [],
            decision: "undecided",
          })),
        });
        await lock.write({ kind: "work", path: work }, () =>
          atomicWrite(
            resolveResourcePath(work, "bible", "pending", `${id}.json`),
            JSON.stringify(batch, null, 2),
          ),
        );
        return { batch: id, items: batch.items.length };
      },
    }),
    defineTool({
      name: "fanqie_start_ledger",
      description: "为指定章节发起记账，结果待作者确认",
      params: obj({ chapterId: str({ min: 1 }) }),
      jsonSchema: {
        type: "object",
        properties: { chapterId: stringProp },
        required: ["chapterId"],
      },
      roles: ["assistant"],
      async run({ chapterId }, ctx) {
        assertWorkspaceWritable(ctx.readonly);
        return host(ctx).startPipeline("fanqie.ledger", { chapterId, trigger: "manual" });
      },
    }),
    defineTool({
      name: "fanqie_open_plan",
      description: "打开大纲·设定的指定页面",
      params: obj({
        target: lit("outline", "entity", "import", "pending", "checks", "history"),
        id: opt(str()),
      }),
      jsonSchema: {
        type: "object",
        properties: { target: stringProp, id: stringProp },
        required: ["target"],
      },
      roles: ["assistant"],
      async run({ target, id }, ctx) {
        host(ctx).navigate({
          view: "plan",
          tab: target === "entity" ? "library" : target,
          ...(id ? { id } : {}),
        });
        return { opened: true };
      },
    }),
  ];
  return tools.map((tool): ToolDefinition => tool);
}
