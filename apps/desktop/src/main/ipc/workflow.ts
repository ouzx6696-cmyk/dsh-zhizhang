import { learningStatus, decideLearning } from "../../session/learning-store";
import path from "node:path";
import { atomicWrite, readJson } from "../../../../../packages/core/src/fsx";
import { asRecord } from "./validate";
import { handle } from "./handle";
import type { Runtime } from "../runtime";
export function registerWorkflowIpc(state: Runtime) {
  handle("workflow-history", (target) => state.sessions.workflows.history(target));
  handle("learning", async (target, action, id, text) => {
    if (action !== "status") {
      if (!id) throw new Error("缺少个人规则编号");
      await state.reconfigure(async () => {
        state.maintenance = true;
        try {
          await decideLearning(state.sessions, target, id, action, text);
        } finally {
          state.maintenance = false;
        }
      });
      state.emit({ target, refresh: true });
    }
    return learningStatus(state.sessions, target);
  });
  handle("engine", (value) => {
    if (value === undefined) return state.settings.engine;
    return state.reconfigure(async () => {
      await state.settings.saveEngine(value);
      await state.sessions.dispose();
      state.emit({ refresh: true });
      return state.settings.engine;
    });
  });
  handle("writer-options", (value) => {
    if (value === undefined) return state.writerConfig;
    return state.reconfigure(async () => {
      const file = path.join(state.home, "writer.json"),
        old = await readJson<unknown>(file);
      const raw = old === undefined ? {} : asRecord(old, "写作配置");
      await atomicWrite(file, JSON.stringify({ ...raw, ...value }, null, 2));
      await state.sessions.dispose();
      Object.assign(state.writerConfig, value);
      state.emit({ refresh: true });
      return state.writerConfig;
    });
  });
  handle("workflow", async (target, action, value) => {
    if (state.maintenance) throw new Error("正在恢复作品，请稍后开始流水线");
    if (action === "pause") await state.sessions.workflows.stop(target);
    if (action === "apply")
      await state.reconfigure(async () => {
        state.maintenance = true;
        try {
          return await state.sessions.workflows.apply(target);
        } finally {
          state.maintenance = false;
        }
      });
    if (action === "start" || action === "replace") {
      if (!value) throw new Error("缺少流水线任务");
      return action === "replace"
        ? state.sessions.workflows.replace(target, value)
        : state.sessions.workflows.start(target, value);
    }
    if (action === "resume") {
      const previous = await state.sessions.workflows.status(target);
      if (!previous) throw new Error("没有可恢复的任务");
      return state.sessions.workflows.start(target, previous.request, true);
    }
    return (await state.sessions.workflows.status(target)) ?? null;
  });
  handle("continuity", async (target, action, id) => {
    if (target.mode !== "fanqie") throw new Error("连续性看板只适用于长篇作品");
    if (action === "migrate") return (await state.sessions.workflows.migrate(target)).state;
    if (action === "accept" || action === "reject") {
      if (!id) throw new Error("缺少事实编号");
      return state.sessions.workflows.decide(target, id, action === "accept");
    }
    return state.sessions.workflows.continuity(target);
  });
}
