/**
 * 助手对话落盘：<状态目录>/sessions/<目标哈希>/<对话 id>.json + current.json 指针。
 * 只读写 zhizhang/1.3 格式；不认识的文件报 storage.format_unsupported。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, shortHash } from "@zhizhang/core/fs";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import type { ConversationItem, Target } from "../shared/views.js";
import type { AgentMessage, AgentToolCall, ConversationFile, JsonArgs } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseToolCall(value: unknown): AgentToolCall | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return undefined;
  const args: JsonArgs = isRecord(value.args) ? value.args : {};
  return { id: value.id, name: value.name, args };
}

function parseMessage(value: unknown): AgentMessage | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  const base = { id: value.id, at: num(value.at) };
  switch (value.role) {
    case "user":
      return { role: "user", ...base, text: text(value.text) };
    case "summary":
      return { role: "summary", ...base, text: text(value.text), replaced: num(value.replaced) };
    case "tool":
      return {
        role: "tool",
        ...base,
        callId: text(value.callId),
        name: text(value.name),
        text: text(value.text),
        isError: value.isError === true,
      };
    case "assistant": {
      const calls = Array.isArray(value.toolCalls) ? value.toolCalls.map(parseToolCall) : [];
      const origin = isRecord(value.origin)
        ? { connection: text(value.origin.connection), model: text(value.origin.model) }
        : undefined;
      return {
        role: "assistant",
        ...base,
        text: text(value.text),
        toolCalls: calls.filter((c): c is AgentToolCall => c !== undefined),
        ...(origin ? { origin } : {}),
        ...(value.raw !== undefined ? { raw: value.raw } : {}),
      };
    }
    default:
      return undefined;
  }
}

function parseConversation(raw: string, file: string): ConversationFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AppError("storage.format_unsupported", `对话记录无法解析：${file}`, { file });
  }
  if (
    !isRecord(data) ||
    data.format !== FORMAT_VERSION ||
    typeof data.id !== "string" ||
    !isRecord(data.target) ||
    !Array.isArray(data.messages)
  ) {
    throw new AppError("storage.format_unsupported", `不支持的对话记录格式：${file}`, { file });
  }
  const mode = data.target.mode === "toutiao" ? "toutiao" : "fanqie";
  const messages = data.messages.map(parseMessage).filter((m): m is AgentMessage => m !== undefined);
  return {
    format: FORMAT_VERSION,
    id: data.id,
    target: { mode, path: text(data.target.path) },
    title: text(data.title),
    created: text(data.created),
    updated: text(data.updated),
    messages,
  };
}

export interface ConversationStore {
  current(target: Target): Promise<ConversationFile>;
  open(target: Target, id: string): Promise<ConversationFile>;
  create(target: Target): Promise<ConversationFile>;
  /** 把历史对话设为当前对话（继续该对话）。 */
  select(target: Target, id: string): Promise<ConversationFile>;
  save(conversation: ConversationFile): Promise<void>;
  list(target: Target): Promise<ConversationItem[]>;
}

export function createConversationStore(root: string, clock: Clock): ConversationStore {
  const dirOf = (target: Target) => path.join(root, `${target.mode}-${shortHash(path.resolve(target.path))}`);
  const fileOf = (target: Target, id: string) => {
    if (!/^[\w-]+$/.test(id)) throw new AppError("input.invalid", `对话 id 无效：${id}`, { id });
    return path.join(dirOf(target), `${id}.json`);
  };
  const pointerOf = (target: Target) => path.join(dirOf(target), "current.json");
  let counter = 0;

  function fresh(target: Target): ConversationFile {
    counter += 1;
    const now = clock.iso();
    return {
      format: FORMAT_VERSION,
      id: `c${clock.now().toString(36)}${counter.toString(36)}`,
      target: { mode: target.mode, path: path.resolve(target.path) },
      title: "",
      created: now,
      updated: now,
      messages: [],
    };
  }

  async function writePointer(target: Target, id: string): Promise<void> {
    await atomicWrite(pointerOf(target), JSON.stringify({ format: FORMAT_VERSION, id }, null, 2));
  }

  async function open(target: Target, id: string): Promise<ConversationFile> {
    const file = fileOf(target, id);
    const raw = await readTextIfExists(file);
    if (raw === undefined) throw new AppError("input.not_found", `未找到对话：${id}`, { id });
    return parseConversation(raw, file);
  }

  return {
    async current(target) {
      const raw = await readTextIfExists(pointerOf(target));
      if (raw !== undefined) {
        let id: unknown;
        try {
          id = JSON.parse(raw).id;
        } catch {
          id = undefined;
        }
        if (typeof id === "string") {
          const file = fileOf(target, id);
          const body = await readTextIfExists(file);
          if (body !== undefined) return parseConversation(body, file);
          return { ...fresh(target), id };
        }
      }
      const created = fresh(target);
      await writePointer(target, created.id);
      return created;
    },
    open,
    async create(target) {
      const created = fresh(target);
      await writePointer(target, created.id);
      return created;
    },
    async select(target, id) {
      const conv = await open(target, id);
      await writePointer(target, conv.id);
      return conv;
    },
    async save(conversation) {
      const target: Target = conversation.target;
      await atomicWrite(fileOf(target, conversation.id), JSON.stringify(conversation, null, 2));
    },
    async list(target) {
      const dir = dirOf(target);
      const names = await fs.readdir(dir).catch(() => []);
      const pointer = await readTextIfExists(pointerOf(target));
      let currentId = "";
      try {
        currentId = pointer ? text(JSON.parse(pointer).id) : "";
      } catch {
        currentId = "";
      }
      const items: ConversationItem[] = [];
      for (const name of names) {
        if (!name.endsWith(".json") || name === "current.json") continue;
        const file = path.join(dir, name);
        const raw = await readTextIfExists(file);
        if (raw === undefined) continue;
        const conv = parseConversation(raw, file);
        items.push({
          id: conv.id,
          title: conv.title,
          updated: conv.updated,
          messages: conv.messages.filter((m) => m.role === "user").length,
          current: conv.id === currentId,
        });
      }
      return items.sort((a, b) => b.updated.localeCompare(a.updated));
    },
  };
}
