import { assertWorkspaceWritable } from "./workspace-lock.js";
import { atomicWrite, readText } from "./fsx.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
/**
 * Small pre-decision copies; existing immutable revisions remain authoritative.
 * 快照是作者回退的依据，同样走原子写：中途失败不能留下半份快照冒充完整副本。
 */
export async function snapshotFiles(root: string, files: string[]) {
  await assertWorkspaceWritable(root);
  const existing: { file: string; text: string }[] = [];
  for (const file of files) {
    const text = await readText(file);
    if (text !== undefined) existing.push({ file, text });
  }
  if (!existing.length) return;
  const output = path.join(
    root,
    ".writer-snapshots",
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8),
  );
  for (const [index, { file, text }] of existing.entries())
    await atomicWrite(path.join(output, `${index}-${path.basename(file)}`), text);
  return output;
}
