import path from "node:path";
import { dialog } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { localDay } from "../../../../../packages/core/src/fsx";
import type { Runtime } from "../runtime";
import { handle } from "./handle";
import { lockRoot } from "../targets";
import { inspectRecovery, recoverWork } from "../../recovery";

async function backupDirectory(state: Runtime, source: string) {
  const result = await dialog.showOpenDialog(state.windowOrThrow(), {
    title: "选择备份保存位置（写作根以外）",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled) return null;
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${localDay(now)}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const output = path.join(result.filePaths[0], `写作备份-${stamp}`);
  await promisify(execFile)(
    process.execPath,
    [
      path.join(state.resources, "scripts/writer-backup.mjs"),
      "--source",
      source,
      "--output",
      output,
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      maxBuffer: 1024 * 1024,
    },
  );
  await promisify(execFile)(
    process.execPath,
    [path.join(state.resources, "scripts/writer-backup.mjs"), "--verify", output],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, maxBuffer: 1024 * 1024 },
  );
  await state.diagnostics.write("backup_completed");
  return { file: output };
}

function recoverPrompt(work: string, check: Awaited<ReturnType<typeof inspectRecovery>>) {
  const confirmClosed = "请确认没有其他窗口或进程正在写入这部作品。";
  if (check.kind === "lock")
    return `清理《${work}》的遗留写入锁？${confirmClosed}确认后将先清理写锁，再备份并校验。`;
  if (check.staleLock)
    return `恢复《${work}》的未完成写入？发现遗留写入锁，${confirmClosed}确认后将先清理写锁，再备份并校验，最后完成原操作。`;
  return `恢复《${work}》的未完成写入？将先备份并校验，再完成原操作。`;
}

export function registerBackupIpc(state: Runtime) {
  handle("backup", async () => {
    if (!state.settings.workspace) throw new Error("请先选择写作根");
    return backupDirectory(state, state.settings.workspace);
  });
  handle("storage-health", async () => {
    if (!state.target) throw new Error("请先选择作品");
    const current = { ...state.target };
    return {
      ...(await inspectRecovery(await lockRoot(state, current))),
      target: current,
      label: current.work || "当前目录",
    };
  });
  handle("recover", async (value) => {
    if (state.maintenance) throw new Error("已有恢复操作正在进行");
    if (!state.target?.work || state.target.mode !== "fanqie")
      throw new Error("请先打开待恢复的长篇作品");
    if (state.sessions.hasPending() || state.sessions.running().length)
      throw new Error("请先停止所有任务，再检查恢复");
    const expected = value;
    const current = { ...state.target, work: state.target.work };
    state.maintenance = true;
    try {
      const dir = await lockRoot(state, current);
      const check = await inspectRecovery(dir);
      if (
        !check.canRecover ||
        check.id !== expected.id ||
        check.fingerprint !== expected.fingerprint
      )
        throw new Error("恢复条件已变化，请重新检查：" + check.reason);
      if (!(await state.confirm(recoverPrompt(current.work, check)))) return null;
      const result = await recoverWork(
        dir,
        { id: check.id, fingerprint: check.fingerprint },
        {
          backup: async () => (await backupDirectory(state, dir))?.file || null,
          lockCleared: (owner) =>
            state.diagnostics.write("write_lock_cleared", {
              work: current.work,
              pid: owner.pid,
              host: owner.host,
              createdAt: owner.createdAt,
            }),
        },
      );
      state.emit({ target: current, refresh: true });
      return { file: result.backup, state: result.state };
    } finally {
      state.maintenance = false;
    }
  });
}
