import path from "node:path";
import { app, BrowserWindow, dialog, Notification } from "electron";
import type { Target } from "../context";
import type { Diagnostics } from "../diagnostics";
import { explainError } from "../diagnostics";
import type { ModelSettings } from "../models";
import type { DesktopEvent, UpdateStatus } from "../renderer-contracts";
import type { Sessions } from "../session";
import type { Settings } from "../settings";
import type { FanqieConfig } from "../../../../packages/fanqie/src/config";
import type { ToutiaoConfig } from "../../../../packages/toutiao/src/config";
import { releaseWorkspace } from "../../../../packages/core/src/workspace-lock";
import { lockRoot } from "./targets";

type WriterConfig = {
  toutiao?: ToutiaoConfig;
  fanqie?: FanqieConfig;
};

/** Shared, mutable main-process state. Every IPC domain reads and writes through it. */
export class Runtime {
  window?: BrowserWindow;
  sessions!: Sessions;
  settings!: Settings;
  model!: ModelSettings;
  diagnostics!: Diagnostics;
  home = "";
  resources = "";
  target?: Target;
  access: { readOnly: boolean; owner: { host?: string } | null } = {
    readOnly: false,
    owner: null,
  };
  maintenance = false;
  updateState: UpdateStatus = { state: "idle" };
  deliveries = new Map<string, Promise<{ status: number; data: any }>>();
  writerConfig: WriterConfig = {};
  notice = "";
  private confirmations = Promise.resolve();

  emit(value: DesktopEvent) {
    if (value.error) value = { ...value, error: explainError(value.error) };
    const eventTarget = value.target;
    if (value.event?.type === "agent_settled") {
      void this.diagnostics?.write("task_ended", {
        mode: value.target?.mode,
        work: value.target?.work,
        aborted: value.event.aborted,
      });
      if (!value.editor && !this.window?.isFocused() && Notification.isSupported()) {
        const notification = new Notification({
          title: "写作 Agent",
          body: value.event.aborted
            ? "任务已停止，已保存结果保留"
            : "写作任务已结束，等待你查看稿件与回报。",
        });
        notification.on("click", () => {
          this.window?.show();
          this.window?.focus();
          this.emit({ navigate: value.target, focus: value.focus });
        });
        notification.show();
      }
      if (
        eventTarget &&
        this.target &&
        this.sessions &&
        this.sessions.key(eventTarget) !== this.sessions.key(this.target) &&
        !this.sessions
          .running()
          .some((item) => this.sessions.key(item.target) === this.sessions.key(eventTarget))
      )
        void lockRoot(this, eventTarget)
          .then(releaseWorkspace)
          .catch(() => {});
    }
    if (value.event?.type === "tool_execution_end")
      void this.diagnostics?.write("tool_ended", { tool: value.event.toolName });
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.send("writer:event", value);
  }

  confirm(text: string, signal?: AbortSignal): Promise<boolean> {
    const result = this.confirmations.then(async () => {
      if (signal?.aborted) return false;
      if (!this.window) return false;
      const answer = await dialog.showMessageBox(this.window, {
        type: "question",
        title: "作者确认",
        message: text,
        buttons: ["取消", "确认"],
        defaultId: 0,
        cancelId: 0,
        signal,
      });
      return !signal?.aborted && answer.response === 1;
    });
    this.confirmations = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  pythonPath() {
    return app.isPackaged
      ? path.join(
          process.resourcesPath,
          "python",
          process.platform === "win32" ? "python.exe" : "bin/python3",
        )
      : process.env.WRITER_PYTHON || (process.platform === "win32" ? "py -3" : "python3");
  }
}
