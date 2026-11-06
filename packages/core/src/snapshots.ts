import { assertWorkspaceWritable } from "./workspace-lock.js";
import { isMissingFileError } from "./fsx.js";
import { mkdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
/** Small pre-decision copies; existing immutable revisions remain authoritative. */
export async function snapshotFiles(root: string, files: string[]) {
  await assertWorkspaceWritable(root);
  const existing: string[] = [];
  for (const file of files) {
    try {
      if ((await stat(file)).isFile()) existing.push(file);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  if (!existing.length) return;
  const output = path.join(
    root,
    ".writer-snapshots",
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8),
  );
  await mkdir(output, { recursive: true });
  for (const [index, file] of existing.entries())
    await copyFile(file, path.join(output, `${index}-${path.basename(file)}`));
  return output;
}
