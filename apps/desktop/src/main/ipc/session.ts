import type { Runtime } from "../runtime";
import { handle } from "./handle";
import { request } from "../operations";
import { selectTarget } from "../targets";

export function registerSessionIpc(state: Runtime) {
  handle("new-conversation", async (next) => {
    await state.sessions.newConversation(next);
    return true as const;
  });
  handle("conversations", async (next) =>
    (await state.sessions.conversations(next)).map((item) => ({
      id: item.id,
      name: item.name,
    })),
  );
  handle("select", (next) => selectTarget(state, next));
  handle("view", (next, limit, archive) => state.sessions.view(next, limit, archive));
  handle("running", () => state.sessions.running());
  handle("request", (operation, options) => request(state, operation, options));
  handle("send", async (value, next, focus) => {
    if (state.maintenance) throw new Error("正在恢复作品，请等待完成后再开始任务");
    const text = value;
    if (!text.trim()) return;
    const bound = next ? next : state.target;
    if (!bound) throw new Error("请先选择作品");
    await state.sessions.send(bound, text, focus);
    return true;
  });
  handle("stop", (next) => {
    const target = next ? next : state.target;
    if (!target) throw new Error("请先选择作品");
    return state.sessions.stop(target);
  });
}
