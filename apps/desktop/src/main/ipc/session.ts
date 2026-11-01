import type { Runtime } from "../runtime";
import { handle } from "./handle";
import {
  parseArchive,
  parseFocus,
  parseLimit,
  parseOperation,
  parseTarget,
  parseText,
} from "./validate";
import { request } from "../operations";
import { selectTarget } from "../targets";

export function registerSessionIpc(state: Runtime) {
  handle("new-conversation", async (next) => {
    await state.sessions.newConversation(parseTarget(next));
    return true as const;
  });
  handle("conversations", async (next) =>
    (await state.sessions.conversations(parseTarget(next))).map((item) => ({
      id: item.id,
      name: item.name,
    })),
  );
  handle("select", (next) => selectTarget(state, parseTarget(next)));
  handle("view", (next, limit, archive) =>
    state.sessions.view(parseTarget(next), parseLimit(limit), parseArchive(archive)),
  );
  handle("running", () => state.sessions.running());
  handle("request", (operation, options) =>
    request(state, parseOperation(operation), options ?? {}),
  );
  handle("send", async (value, next, focus) => {
    if (state.maintenance) throw new Error("正在恢复作品，请等待完成后再开始任务");
    const text = parseText(value);
    if (!text.trim()) return;
    const bound = next ? parseTarget(next) : state.target;
    if (!bound) throw new Error("请先选择作品");
    await state.sessions.send(bound, text, parseFocus(focus));
    return true;
  });
  handle("stop", (next) =>
    state.sessions.stop(next ? parseTarget(next) : state.target!),
  );
}
