import { AppError } from "../errors/app-error.js";
import { resolveInside } from "../fs/sandbox.js";

export function assertWorkspaceWritable(readonly: boolean): void {
  if (readonly) {
    throw new AppError("storage.locked", "当前处于只读模式（另一实例正占用写作文件夹）", {
      readonly: true,
    });
  }
}

export function assertInsideWorkspace(root: string, rel: string): string {
  return resolveInside(root, rel);
}
