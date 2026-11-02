import { runAccept, type AcceptInput } from "../../services/accept.js";
import { fail, openWork } from "../context.js";

import type { ExecContext } from "../types.js";
export async function runAcceptPipeline(
  args: Record<string, unknown>,
  exec: ExecContext,
  opts: Omit<AcceptInput, "paths" | "dir" | "workKey">,
) {
  const { paths, dir, key } = await openWork(exec, args);
  const r = await runAccept({ ...opts, paths, dir, workKey: key });
  if (!r.ok) fail(r.error, r.code);
  return [r.receipt, `下一步：${r.nextHint}`].join("\n");
}
