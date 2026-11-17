import { importDocMap } from "./docmap.js";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, sha256, resolveResourcePath } from "@zhizhang/core/fs";
import { createIdSource } from "@zhizhang/core/id";
import { commitIntent, type IntentWrite } from "@zhizhang/core/journal";
import { createLockService } from "@zhizhang/core/lock";
import { systemClock } from "@zhizhang/core/clock";
import type {
  ContextPacket,
  DeliveryReceipt,
  PipelineDefinition,
  RunRecord,
  StageSpec,
} from "@zhizhang/core/pipeline";
import {
  arr,
  int,
  num,
  opt,
  obj,
  str,
  parseJson,
  dropUndefined,
  type Infer,
} from "@zhizhang/core/schema";
import { chunk } from "@zhizhang/core/text";
import {
  readBible,
  readIndexOrEmpty,
  readPendingBatch,
  pendingFilePath,
} from "../../bible/read.js";
import { PendingBatchSchema } from "../../bible/ops-schema.js";
import { readOutline } from "../../outline/store.js";
import { batchPath, persistBatch, readBatch, readSegments } from "../../import/store.js";
import { ExtractResultSchema, ImportProposalSchema } from "../../import/schema.js";
import {
  buildLookup,
  locateExtract,
  parseExtract,
  type LocatedItem,
} from "../../import/extract.js";
import { resolveItems } from "../../import/resolve.js";
import type { ExtractResult, ImportProposal } from "../../import/types.js";

export const ImportReq = obj({
  batch: str({ min: 1, max: 200 }),
  sections: arr(str({ min: 1, max: 60 })),
  retryChunks: opt(arr(int({ min: 0 }))),
  estimate: obj({ inputMax: int({ min: 0 }), outputMax: int({ min: 0 }) }),
});
export type ImportInput = Infer<typeof ImportReq>;
export interface ImportResult {
  batch: string;
  failedChunks: number[];
}
const importConfidence = num({ min: 0, max: 1 });
const lock = createLockService(systemClock);
const PACKET: ContextPacket = {
  prefix: [
    {
      id: "import-policy",
      layer: 0,
      required: true,
      tokens: 80,
      reason: "只提取给定原文",
      source: { kind: "author", ref: "import" },
      text: "从给定来源提取，不编造。每个条目必须带 src 段号和不超过40字的原文 quote；不确定时降低 confidence。只返回指定 JSON。",
    },
  ],
  suffix: [],
  estimate: 80,
  omitted: [],
};

export const importPipeline: PipelineDefinition<ImportInput, ImportResult> = {
  kind: "fanqie.import",
  request: ImportReq,
  async context(target, req) {
    return { runId: createIdSource().next("run"), target, request: req, state: {} };
  },
  async run(runner, ctx) {
    const req = ImportReq(ctx.request),
      work = ctx.target.path;
    const view = await readBatch(work, req.batch);
    if (["closed", "reverted"].includes(view.status))
      throw new AppError("input.invalid", "批次已关闭", { reason: "batch_closed" });
    const source = await readSegments(work, req.batch),
      selected = new Set(req.sections);
    const approved = new Set(
      view.segments.filter((row) => row.selected && row.kind !== "ignore").map((row) => row.id),
    );
    if (!selected.size || [...selected].some((id) => !approved.has(id)))
      throw new AppError("input.invalid", "请选择可导入的分节");
    const segments = source.segments.filter((section) => selected.has(section.id));
    if (segments.reduce((sum, section) => sum + section.end - section.start, 0) > 1000000)
      throw new AppError("input.invalid", "请按卷分批选择分节", {
        reason: "too_long_select_sections",
      });
    const chunks = chunk(
      { ...source, segments },
      {
        maxTokens: Math.min(
          8000,
          (typeof ctx.state.inputBudget === "number" ? ctx.state.inputBudget : 24000) - 9000,
        ),
        estimate: (text) => text.length,
      },
    );
    const bible = await readBible(work),
      index = await readIndexOrEmpty(work),
      outline = await readOutline(work);
    view.status = "running";
    view.runId = ctx.runId;
    await persistBatch(work, req.batch, { "view.json": view }, lock);
    const docmap = await importDocMap(
      runner,
      PACKET,
      view,
      selected,
      await readTextIfExists(batchPath(work, req.batch, "docmap.json")),
    );
    await persistBatch(work, req.batch, { "docmap.json": docmap }, lock);
    const cached = new Map<number, ExtractResult>(),
      pending: typeof chunks = [];
    const keyOf = (item: (typeof chunks)[number]) =>
      sha256(
        JSON.stringify([
          "extract-v1",
          item.breadcrumb,
          item.paras.map((id) => {
            const para = [
              ...segments.flatMap((segment) => segment.paras),
              ...(item.fragments ?? []),
            ].find((para) => para.id === id);
            return para ? source.text.slice(para.start, para.end) : "";
          }),
        ]),
      );
    for (const item of chunks) {
      const cache = resolveResourcePath(work, ".cache", "import", `${keyOf(item)}.json`);
      const raw = await readTextIfExists(cache);
      if (raw) {
        try {
          const box: unknown = JSON.parse(raw);
          if (
            !box ||
            typeof box !== "object" ||
            !("result" in box) ||
            !("paras" in box) ||
            !Array.isArray(box.paras)
          )
            throw new AppError("input.invalid", "旧缓存格式");
          const result = ExtractResultSchema(box.result),
            ids = [...item.contextOnly, ...item.paras];
          const oldIds = box.paras;
          for (const entry of result.items)
            entry.src = entry.src.map((id) => {
              const index = oldIds.indexOf(id);
              return index < 0 ? id : (ids[index] ?? id);
            });
          cached.set(item.index, result);
          continue;
        } catch {
          /* 缓存可删除，坏缓存重算。 */
        }
      }
      if (!req.retryChunks || req.retryChunks.includes(item.index)) pending.push(item);
    }
    const stage: StageSpec<unknown, ExtractResult> = {
      id: "extract",
      title: "按块抽取",
      role: "extractor",
      fanOut: { count: () => pending.length, key: (index) => pending[index].index },
      retries: 1,
      input: (_ctx, position = 0) => {
        const item = pending[position];
        const table = [...segments.flatMap((section) => section.paras), ...(item.fragments ?? [])];
        const ids = [...item.contextOnly, ...item.paras];
        const text = ids
          .map((id) => {
            const para = table.find((row) => row.id === id);
            return para ? `[${id}] ${source.text.slice(para.start, para.end)}` : "";
          })
          .join("\n\n");
        return {
          stage: `【阶段】extract 第 ${item.index + 1} / ${chunks.length} 块`,
          breadcrumb: item.breadcrumb,
          contextOnly: item.contextOnly,
          lookup: buildLookup(bible, text),
          docmap,
          text,
        };
      },
      shape:
        'JSON: {"items":[{"type":"volume|act|chapter|entity|state|thread|timeline|knowledge|note","tmp":"局部唯一id","src":["P1.1"],"quote":"原文引文","confidence":0.9,"...":"该类型的字段；实体含kind/name，章纲含title/parent"}],"unassigned":[]}',
      format: "json",
      parse: parseExtract,
    };
    const answers = await runner.fanOutSettled(stage, PACKET);
    const failedChunks: number[] = req.retryChunks
      ? view.failedChunks.filter((index) => !req.retryChunks?.includes(index))
      : [];
    for (const answer of answers) {
      const item = pending[answer.index];
      if (answer.ok) {
        cached.set(item.index, answer.value);
        await atomicWrite(
          resolveResourcePath(work, ".cache", "import", `${keyOf(item)}.json`),
          JSON.stringify({ result: answer.value, paras: [...item.contextOnly, ...item.paras] }),
        );
      } else failedChunks.push(item.index);
    }
    const located: LocatedItem[] = [],
      unassigned: ImportProposal["unassigned"] = [];
    for (const item of chunks) {
      const answer = cached.get(item.index);
      if (!answer) continue;
      const paras = [
        ...segments.flatMap((section) => section.paras),
        ...(item.fragments ?? []),
      ].filter((para) => [...item.paras, ...item.contextOnly].includes(para.id));
      located.push(
        ...locateExtract(source.text, paras, answer.items, item.index, item.contextOnly),
      );
      unassigned.push(...answer.unassigned);
    }
    const previous = await readPendingBatch(work, req.batch);
    const confirmedLocated = await runner.local("locate", async () => located);
    const items = await runner.local("resolve", async () =>
      resolveItems(
        confirmedLocated,
        bible,
        outline,
        req.batch,
        ctx.runId,
        docmap,
        systemClock.iso(),
        createIdSource(),
        previous?.items,
      ),
    );
    const ambiguous = items.filter((item) => item.notes.includes("import.ambiguous_name"));
    for (let offset = 0; offset < ambiguous.length; offset += 20) {
      const group = ambiguous.slice(offset, offset + 20);
      const decisions = await runner.stage(
        {
          id: `adjudicate-${offset / 20}`,
          title: "核对名称歧义",
          role: "judge",
          input: () => ({
            stage: `【阶段】adjudicate 第 ${offset / 20 + 1} 组`,
            items: group,
            lookup: buildLookup(
              bible,
              group.map((item) => item.src?.map((ref) => ref.quote).join("\n")).join("\n"),
            ),
          }),
          shape: 'JSON: {"decisions":[{"id":"待确认id","note":"核对建议","confidence":0.5}]}',
          format: "json",
          parse: (raw) =>
            parseJson(
              raw,
              obj({
                decisions: arr(
                  obj({ id: str(), note: str({ max: 180 }), confidence: importConfidence }),
                  { max: 20 },
                ),
              }),
              "adjudicate",
            ),
        },
        PACKET,
      );
      for (const decision of decisions.decisions) {
        const item = group.find((item) => item.id === decision.id);
        if (item) {
          item.notes.push(`adjudicate:${decision.note}`);
          item.decision = "undecided";
        }
      }
    }
    const restoredIds = new Map<string, string>();
    if (previous)
      for (const item of items) {
        const old = previous.items.find(
          (row) => row.group === item.group && row.op.type === item.op.type,
        );
        if (old) {
          restoredIds.set(item.id, old.id);
          item.id = old.id;
          item.committed = old.committed;
          item.decision = old.decision;
          item.edited = old.edited;
          item.baseRev = old.baseRev;
        }
      }
    for (const item of items)
      item.dependsOn = item.dependsOn.map((id) => restoredIds.get(id) ?? id);
    const stats: ImportProposal["stats"] = {
      total: items.length,
      byChange: {},
      byBand: {},
      located: located.filter((row) => row.hit.located === "exact").length,
      fuzzy: located.filter((row) => row.hit.located === "fuzzy").length,
      unlocated: located.filter((row) => !row.hit.located).length,
    };
    for (const item of items) {
      stats.byChange[item.change] = (stats.byChange[item.change] ?? 0) + 1;
      const band = item.confidence?.band ?? "low";
      stats.byBand[band] = (stats.byBand[band] ?? 0) + 1;
    }
    const proposal = ImportProposalSchema(
      dropUndefined({
        format: "zhizhang/1.3",
        batch: req.batch,
        run: ctx.runId,
        libRevs: index.files,
        items,
        unassigned,
        failedChunks,
        stats,
      }),
    );
    const batch = PendingBatchSchema(
      dropUndefined({
        format: "zhizhang/1.3",
        id: req.batch,
        source: "import",
        run: ctx.runId,
        created: view.source.importedAt,
        status: "open",
        items,
        commits: previous?.commits ?? [],
      }),
    );
    view.status = failedChunks.length ? "partial" : "reviewing";
    view.failedChunks = failedChunks;
    const values = new Map<string, unknown>([
      [batchPath(work, req.batch, "view.json"), view],
      [batchPath(work, req.batch, "proposal.json"), proposal],
      [pendingFilePath(work, req.batch), batch],
    ]);
    const writes: IntentWrite[] = await Promise.all(
      [...values].map(async ([file, value]) => {
        const raw = await readTextIfExists(file);
        return {
          path: file,
          beforeHash: raw === undefined ? null : sha256(raw),
          after: JSON.stringify(value, null, 2),
        };
      }),
    );
    await commitIntent(
      path.join(work, ".journal"),
      {
        format: "zhizhang/1.3",
        id: createIdSource().next("tx"),
        writes,
        meta: { batch: req.batch, run: ctx.runId },
      },
      lock,
      { kind: "work", path: work },
    );
    return { batch: req.batch, failedChunks };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    return {
      runId: ctx.runId,
      deliveredPaths: [batchPath(ctx.target.path, res.batch, "proposal.json")],
      contentHash: sha256(
        (await readTextIfExists(batchPath(ctx.target.path, res.batch, "proposal.json"))) ?? "",
      ),
      summary: `导入提案待确认；失败块 ${res.failedChunks.length}`,
    };
  },
  async recover(_record: RunRecord) {
    return "resume";
  },
};
