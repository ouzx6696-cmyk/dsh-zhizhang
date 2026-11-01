import path from "node:path";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import { atomicWrite } from "../../../../packages/core/src/fsx";
import type { Target } from "../context";
import { SessionManager } from "./pi-adapter";
import type { Sessions } from "./manager";

export async function conversations(host: Sessions, target: Target) {
  const dir = path.join(host.home, "sessions", host.key(target));
  const history: string[] = JSON.parse(
    await readFile(path.join(dir, "history.json"), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "[]";
      throw error;
    }),
  );
  return history.map((file, index) => ({
    id: index,
    name: path.basename(file).replace(/\.jsonl$/, ""),
    file,
  }));
}

export async function newConversation(host: Sessions, target: Target) {
  const entry = host.sessions.get(host.key(target));
  if (entry && !entry.session.isIdle) throw new Error("请先停止当前任务，再开始新对话");
  const dir = path.join(host.home, "sessions", host.key(target));
  await mkdir(dir, { recursive: true });
  const current = await readFile(path.join(dir, "current"), "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (current) {
    const previous = await conversations(host, target);
    await atomicWrite(
      path.join(dir, "history.json"),
      JSON.stringify([...previous.map((item) => item.file), current]),
    );
  }
  host.release(target);
  await rm(path.join(dir, "current"), { force: true });
}

function history(host: Sessions, manager: SessionManager, limit: number) {
  const leaf = manager.getLeafId();
  const cap = Math.max(1, Math.min(10000, Number(limit) || 80));
  const cached = host.projectedHistory.get(manager);
  if (cached?.leaf === leaf && cached.limit >= cap)
    return { messages: cached.messages.slice(-cap), total: cached.total };
  const branch = manager.getBranch();
  const messages: unknown[] = [];
  let total = 0;
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry.type === "message") {
      total++;
      if (messages.length < cap) messages.push({ ...entry.message, writerMessageId: entry.id });
    } else if (entry.type === "custom_message" && entry.display) {
      total++;
      if (messages.length < cap)
        messages.push({
          role: "custom",
          writerMessageId: entry.id,
          customType: entry.customType,
          content: entry.content,
          display: true,
          timestamp: Date.parse(entry.timestamp),
        });
    }
  }
  messages.reverse();
  host.projectedHistory.set(manager, {
    leaf,
    limit: cap,
    messages,
    total,
  });
  return { messages: messages.slice(-cap), total };
}

export async function view(host: Sessions, target: Target, limit = 80, archive?: number) {
  const entry = archive === undefined ? host.sessions.get(host.key(target)) : undefined;
  let manager = entry?.session.sessionManager;
  if (!manager) {
    const marker =
      archive !== undefined
        ? (await conversations(host, target)).find((item) => item.id === archive)?.file || ""
        : await readFile(
            path.join(host.home, "sessions", host.key(target), "current"),
            "utf8",
          ).catch((error) => {
            if (error.code === "ENOENT") return "";
            throw error;
          });
    if (
      marker &&
      (await access(marker).then(
        () => true,
        () => false,
      ))
    ) {
      const info = await stat(marker, { bigint: true });
      const stamp = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      const cached = host.historyCache.get(marker);
      manager = cached?.stamp === stamp ? cached.manager : SessionManager.open(marker);
      host.historyCache.delete(marker);
      host.historyCache.set(marker, { stamp, manager });
      while (host.historyCache.size > 4)
        host.historyCache.delete(host.historyCache.keys().next().value!);
    }
  }
  const projected = manager
    ? history(host, manager, limit)
    : { messages: [] as unknown[], total: 0 };
  const streaming = entry?.session.agent.state.streamingMessage;
  const stream =
    streaming?.role === "assistant"
      ? streaming.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("")
      : "";
  return {
    messages: projected.messages,
    total: projected.total,
    busy: entry ? !entry.session.isIdle : false,
    stream,
    phase: entry?.phase || "",
    focus: entry?.focus,
    task: entry?.task,
  };
}
