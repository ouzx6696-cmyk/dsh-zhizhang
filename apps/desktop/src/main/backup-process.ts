import { utilityProcess } from "electron";
import { AppError } from "@zhizhang/core/errors";

/** 备份在 Node utility process 里运行（生产包关闭了 RunAsNode fuse，不能直接 spawn node）。 */
export function runBackup(script: string, args: string[], signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new AppError("run.stopped", "备份已取消"));
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
      if (signal.aborted) reject(new AppError("run.stopped", "备份已取消"));
      else if (code !== 0) reject(new AppError("storage.io", errorText.trim() || `备份进程退出：${code}`, { code }));
      else resolve();
    });
  });
}
