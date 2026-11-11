import path from "node:path";
import { readdir } from "node:fs/promises";
import { errorText } from "../../../../packages/core/src/errors";
import { WorkflowJournal, type WorkflowRecord } from "../../../../packages/core/src/workflow";
import type { DiagnosticFields } from "../../../../packages/core/src/diagnostics";

/** 读一个作品的全部流水线记录，新的在前；单份损坏只记诊断日志，不影响其余记录。 */
export async function readWorkflowHistory(
  dir: string,
  log?: (event: string, fields: DiagnosticFields) => void,
) {
  const rows: WorkflowRecord[] = [];
  try {
    for (const name of await readdir(dir))
      if (/^run-[a-f0-9]+\.json$/.test(name)) {
        try {
          const value = await WorkflowJournal.read(path.join(dir, name));
          if (value) rows.push(value);
        } catch (error) {
          // allow-catch: 单份历史损坏时保留其余记录；原因写入诊断日志供排查。
          log?.("workflow_history_unavailable", {
            file: name,
            error: errorText(error),
          });
        }
      }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return rows.sort((a, b) => b.created.localeCompare(a.created));
}
