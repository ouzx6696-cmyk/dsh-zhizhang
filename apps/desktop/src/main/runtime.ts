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
import { WriterError } from "../../../../packages/core/src/tool";
import { releaseInactiveTarget } from "./targets";
import { taskEndCopy } from "../../../../packages/ui/src/copy";

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
  deliveries = new Map<string, Promise<{ status: number; data: unknown }>>();
  writerConfig: WriterConfig = {};
  notice = "";
  private confirmations = Promise.resolve();

  /** 窗口关闭后对象仍在但已销毁，任何方法调用都会抛错；退出期间的收尾事件须跳过它。 */
  private liveWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  emit(value: DesktopEvent) {
    if (value.error) value = { ...value, error: explainError(value.error) };
    this.liveWindow()?.webContents.send("writer:event", value);
  }

  /** 弹对话框必须挂在窗口上；窗口尚未创建或已销毁（正在退出）时如实报错。 */
  windowOrThrow(): BrowserWindow {
    const window = this.liveWindow();
    if (!window) throw new WriterError("NOT_FOUND", "界面窗口尚未就绪或已关闭，无法弹出对话框");
    return window;
  }

  async sessionEvent(value: DesktopEvent) {
    this.emit(value);
    try {
      if (value.event?.type === "agent_settled") {
        await Promise.all([
          this.diagnostics.write("task_ended", {
            mode: value.target?.mode,
            work: value.target?.work,
            reason: value.event.reason,
            message: value.event.error,
          }),
          this.notifyTask(value),
          value.target ? releaseInactiveTarget(this, value.target) : Promise.resolve(),
        ]);
      } else if (value.event?.type === "tool_execution_end") {
        await this.diagnostics.write("tool_ended", { tool: value.event.toolName });
      }
    } catch (error) {
      this.notice = "任务结束后的处理失败：" + String(error);
      this.emit({ error: this.notice });
    }
  }

  private notifyTask(value: DesktopEvent) {
    const window = this.liveWindow();
    if (value.editor || !window || window.isFocused() || !Notification.isSupported()) return;
    const notification = new Notification({
      title: "写作 Agent",
      body: taskEndCopy(value.event?.reason, value.event?.error),
    });
    notification.on("click", () => {
      const current = this.liveWindow();
      if (!current) return;
      current.show();
      current.focus();
      this.emit({ navigate: value.target, focus: value.focus });
    });
    notification.show();
  }

  confirm(text: string, signal?: AbortSignal): Promise<boolean> {
    const result = this.confirmations.then(async () => {
      const window = this.liveWindow();
      if (signal?.aborted || !window) return false;
      const answer = await dialog.showMessageBox(window, {
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
