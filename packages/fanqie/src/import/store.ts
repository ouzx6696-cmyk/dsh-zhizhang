import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, resolveResourcePath, sha256 } from "@zhizhang/core/fs";
import { createIdSource } from "@zhizhang/core/id";
import { commitIntent, type IntentWrite } from "@zhizhang/core/journal";
import type { LockService } from "@zhizhang/core/lock";
import {
  SegmentRulesSchema,
  chunk,
  detectEncoding,
  normalize,
  segment,
  type SegmentResult,
  type SegmentRules,
  type TextEncoding,
} from "@zhizhang/core/text";
import { ImportBatchViewSchema, ImportProposalSchema, SectionKindSchema } from "./schema.js";
import type { ImportBatchView, ImportEstimate, ImportProposal, SectionKind } from "./types.js";

export interface ImportBudget {
  inputBudget: number;
  runBudget: number;
  model?: string;
}
const DEFAULT_BUDGET: ImportBudget = { inputBudget: 24000, runBudget: 120000 };
export function batchPath(work: string, batch: string, file: string): string {
  if (!/^imp-[0-9A-HJKMNP-TV-Z]{8}$/.test(batch))
    throw new AppError("input.invalid", "无效导入批次", { batch });
  return resolveResourcePath(work, "imports", batch, file);
}
export async function readBatch(work: string, batch: string): Promise<ImportBatchView> {
  const raw = await readTextIfExists(batchPath(work, batch, "view.json"));
  if (raw === undefined) throw new AppError("input.not_found", "导入批次不存在", { batch });
  try {
    return ImportBatchViewSchema(JSON.parse(raw));
  } catch {
    throw new AppError("storage.format_unsupported", "导入批次格式不受支持", { batch });
  }
}
export async function readSegments(work: string, batch: string): Promise<SegmentResult> {
  const [raw, text] = await Promise.all([
    fs.readFile(batchPath(work, batch, "segments.json"), "utf8"),
    fs.readFile(batchPath(work, batch, "source.txt"), "utf8"),
  ]);
  const view = await readBatch(work, batch);
  if (sha256(text) !== view.source.sha256)
    throw new AppError("storage.conflict", "导入原文已变化，请重新导入", {
      batch,
      reason: "source_changed",
    });
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("format" in value) ||
    !("segments" in value) ||
    !Array.isArray(value.segments)
  )
    throw new AppError("storage.format_unsupported", "分节数据损坏");
  // 从源文本重新分节可避免信任被手工改坏的偏移；保存的作者规则是唯一重建依据。
  const settings = await readTextIfExists(batchPath(work, batch, "rules.json"));
  return segment(text, {
    format: value.format === "md" ? "md" : "txt",
    rules: settings ? SegmentRulesSchema(JSON.parse(settings)) : undefined,
  });
}
export async function readProposal(work: string, batch: string): Promise<ImportProposal> {
  try {
    return ImportProposalSchema(
      JSON.parse(await fs.readFile(batchPath(work, batch, "proposal.json"), "utf8")),
    );
  } catch (error) {
    throw new AppError("storage.format_unsupported", "导入提案不存在或已损坏", {
      batch,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
export async function persistBatch(
  work: string,
  batch: string,
  values: Record<string, unknown>,
  lock: LockService,
) {
  const writes: IntentWrite[] = await Promise.all(
    Object.entries(values).map(async ([name, value]) => {
      const file = batchPath(work, batch, name),
        raw = await readTextIfExists(file);
      return {
        path: file,
        beforeHash: raw === undefined ? null : sha256(raw),
        after: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      };
    }),
  );
  await commitIntent(
    path.join(work, ".journal"),
    { format: "zhizhang/1.3", id: createIdSource().next("tx"), writes, meta: { batch } },
    lock,
    { kind: "work", path: work },
  );
}
export function estimateImport(
  result: SegmentResult,
  view: ImportBatchView,
  budget: ImportBudget = DEFAULT_BUDGET,
): ImportEstimate {
  const selected = new Set(
    view.segments.filter((item) => item.selected && item.kind !== "ignore").map((item) => item.id),
  );
  const maxTokens = Math.min(8000, budget.inputBudget - 9000);
  if (maxTokens < 1) throw new AppError("input.invalid", "输入预算不足，请提高到 9000 token 以上");
  const chunks = chunk(
    { ...result, segments: result.segments.filter((item) => selected.has(item.id)) },
    { maxTokens, estimate: (text) => text.length },
  );
  const inputMin = chunks.reduce((sum, item) => sum + item.tokens + 4000 + 1500 + 2500, 2500);
  const inputMax = Math.ceil(inputMin * 1.3);
  const outputMin = Math.ceil(
    chunks.reduce((sum, item) => sum + Math.min(6000, item.tokens * 0.25), 800),
  );
  const outputMax = Math.ceil(
    chunks.reduce((sum, item) => sum + Math.min(6000, item.tokens * 0.45), 800) * 1.3,
  );
  return {
    chunks: chunks.length,
    tokens: { inputMin, inputMax, outputMin, outputMax },
    moneyRef: null,
    model: budget.model ?? "configured",
    runBudget: Math.min(
      10000000,
      Math.max(budget.runBudget, Math.ceil((inputMax + outputMax) * 2)),
    ),
  };
}
export async function listBatches(work: string) {
  const names = await fs.readdir(path.join(work, "imports")).catch((): string[] => []);
  return Promise.all(
    names
      .filter((name) => /^imp-[0-9A-HJKMNP-TV-Z]{8}$/.test(name))
      .map((name) => readBatch(work, name)),
  );
}
function editable(view: ImportBatchView) {
  if (["running", "closed", "reverted"].includes(view.status))
    throw new AppError("input.invalid", "当前批次不能修改", { reason: "batch_closed" });
}
export function createImportStore(
  lock: LockService,
  budget: () => ImportBudget = () => DEFAULT_BUDGET,
  now = () => new Date().toISOString(),
) {
  async function stage(work: string, file: string, rules?: SegmentRules) {
    return lock.write({ kind: "work", path: work }, async () => {
      const ext = path.extname(file).toLowerCase();
      if (ext !== ".txt" && ext !== ".md")
        throw new AppError("input.invalid", "只支持 TXT / MD", { reason: "file_type" });
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
        throw new AppError("input.invalid", "文件超出 20 MB 限制", { reason: "file_too_large" });
      const bytes = await fs.readFile(file),
        guess = detectEncoding(bytes);
      const text = normalize(new TextDecoder(guess.encoding, { fatal: true }).decode(bytes)).text;
      const result = segment(text, { format: ext === ".md" ? "md" : "txt", rules });
      const batch = createIdSource().next("imp"),
        hash = sha256(text);
      const duplicate = (await listBatches(work)).find((item) => item.source.sha256 === hash);
      const view: ImportBatchView = {
        batch,
        status: "staged",
        source: {
          name: path.basename(file),
          bytes: stat.size,
          sha256: hash,
          encoding: guess.encoding,
          encodingConfidence: guess.confidence,
          importedAt: now(),
        },
        segments: result.segments.map((item) => ({
          id: item.id,
          title: item.title,
          level: item.level,
          kind: SectionKindSchema(item.hint === "meta" ? "ignore" : (item.hint ?? "unknown")),
          paras: item.paras.length,
          selected: text.length <= 1000000 && item.hint !== "meta",
        })),
        failedChunks: [],
        duplicateOf: duplicate?.batch,
        encodingCandidates: guess.candidates,
      };
      view.estimate = estimateImport(result, view, budget());
      const { text: _text, ...seg } = result;
      await persistBatch(
        work,
        batch,
        {
          "source.txt": text,
          "source.json": view.source,
          "view.json": view,
          "segments.json": seg,
          "rules.json": rules ?? {},
          "raw.json": { base64: bytes.toString("base64") },
        },
        lock,
      );
      return view;
    });
  }
  async function resegment(
    work: string,
    batch: string,
    rules: SegmentRules,
    encoding?: TextEncoding,
  ) {
    return lock.write({ kind: "work", path: work }, async () => {
      const view = await readBatch(work, batch);
      editable(view);
      let text = await fs.readFile(batchPath(work, batch, "source.txt"), "utf8");
      if (encoding) {
        const raw = JSON.parse(await fs.readFile(batchPath(work, batch, "raw.json"), "utf8"));
        text = normalize(
          new TextDecoder(encoding, { fatal: true }).decode(Buffer.from(raw.base64, "base64")),
        ).text;
        view.source.encoding = encoding;
        view.source.encodingConfidence = 1;
        view.source.sha256 = sha256(text);
      }
      const result = segment(text, {
        format: path.extname(view.source.name).toLowerCase() === ".md" ? "md" : "txt",
        rules,
      });
      view.segments = result.segments.map((item) => ({
        id: item.id,
        title: item.title,
        level: item.level,
        kind: SectionKindSchema(item.hint === "meta" ? "ignore" : (item.hint ?? "unknown")),
        paras: item.paras.length,
        selected: item.hint !== "meta" && text.length <= 1000000,
      }));
      view.estimate = estimateImport(result, view, budget());
      const { text: _text, ...seg } = result;
      await persistBatch(
        work,
        batch,
        {
          "source.txt": text,
          "source.json": view.source,
          "segments.json": seg,
          "rules.json": rules,
          "view.json": view,
        },
        lock,
      );
      return view;
    });
  }
  async function select(
    work: string,
    batch: string,
    sections: Array<{ id: string; selected: boolean; kind?: SectionKind }>,
  ) {
    return lock.write({ kind: "work", path: work }, async () => {
      const view = await readBatch(work, batch);
      editable(view);
      for (const item of sections) {
        const target = view.segments.find((row) => row.id === item.id);
        if (!target) throw new AppError("input.invalid", "分节不存在", { section: item.id });
        target.selected = item.selected;
        if (item.kind) target.kind = item.kind;
      }
      view.estimate = estimateImport(await readSegments(work, batch), view, budget());
      await persistBatch(work, batch, { "view.json": view }, lock);
      return view;
    });
  }
  return { stage, resegment, select, list: listBatches };
}
