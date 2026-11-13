import { utilityProcess } from "electron";
import { WriterError } from "../../../../packages/core/src/tool";

/** A Node utility process works with the production RunAsNode fuse disabled. */
export function runBackup(script: string, args: string[], signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new WriterError("CANCELLED", "备份已取消"));
  return new Promise<void>((resolve, reject) => {
    const child = utilityProcess.fork(script, args, { stdio: "pipe", serviceName: "作品备份" });
    let errorText = "";
    const stop = () => {
      child.kill();
    };
    signal.addEventListener("abort", stop, { once: true });
    child.stdout?.resume();
    child.stderr?.on("data", (chunk: Buffer) => {
      errorText = (errorText + chunk.toString("utf8")).slice(-65536);
    });
    child.once("exit", (code) => {
      signal.removeEventListener("abort", stop);
      if (signal.aborted) reject(new WriterError("CANCELLED", "备份已取消"));
      else if (code !== 0) reject(new Error(errorText.trim() || `备份进程退出：${code}`));
      else resolve();
    });
  });
}
