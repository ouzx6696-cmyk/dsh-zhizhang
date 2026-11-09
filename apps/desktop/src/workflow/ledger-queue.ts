import { atomicWrite, readJson, serialize } from "../../../../packages/core/src/fsx";
import { isRecord } from "../../../../packages/core/src/parse";
import { WriterError } from "../../../../packages/core/src/tool";
import {
  parseWorkflowRequest,
  type WorkflowRequest,
} from "../../../../packages/core/src/workflow-config";

/** The continuity ledger run for one chapter the author has just finalized. */
export function ledgerRequest(chapter: string): WorkflowRequest {
  return parseWorkflowRequest({
    kind: "ledger",
    chapter,
    instruction: "记录作者已定稿章节的实际变化，冲突交作者确认。",
    grade: "economy",
    source: "",
    line: "news",
  });
}

function broken(file: string) {
  return `待补记账队列已损坏（${file}），无法确定哪些定稿章节还没有记账；文件已原样保留。请在流水线中为最近定稿的章节逐一运行“定稿记账”，完成后删除该文件。`;
}

async function readQueue(file: string): Promise<string[]> {
  let raw: unknown;
  try {
    raw = await readJson<unknown>(file);
  } catch (error) {
    if (error instanceof WriterError && error.code === "CONFLICT")
      throw new Error(broken(file), { cause: error });
    throw error;
  }
  if (raw === undefined) return [];
  if (!isRecord(raw) || !Array.isArray(raw.chapters)) throw new Error(broken(file));
  return raw.chapters.map((chapter) => {
    if (typeof chapter !== "string") throw new Error(broken(file));
    return ledgerRequest(chapter).chapter;
  });
}

function writeQueue(file: string, chapters: string[]) {
  return atomicWrite(file, JSON.stringify({ chapters }, null, 2));
}

/** Finalized chapters still owed a ledger run, oldest first, each listed once. */
export function pendingLedger(file: string) {
  return serialize(file, () => readQueue(file));
}

export function addPendingLedger(file: string, chapters: string[]) {
  return serialize(file, async () => {
    const queue = await readQueue(file);
    const next = [...new Set([...queue, ...chapters])];
    if (next.length !== queue.length) await writeQueue(file, next);
  });
}

export function removePendingLedger(file: string, chapter: string) {
  return serialize(file, async () => {
    const queue = await readQueue(file);
    if (queue.includes(chapter))
      await writeQueue(
        file,
        queue.filter((value) => value !== chapter),
      );
  });
}
