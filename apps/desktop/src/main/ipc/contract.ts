import { parseContextSettings, type ContextSettings } from "../../context-settings";
import type { Focus, Target } from "../../context";
import type { ModelConnection, ModelSettings } from "../../models";
import type { TaskState, UpdateStatus } from "../../renderer-contracts";
import type { Settings } from "../../settings";
import type { inspectRecovery } from "../../recovery";

export type PublicSettings = ReturnType<Settings["public"]>;
export type StorageHealth = Awaited<ReturnType<typeof inspectRecovery>> & {
  target: Target;
  label: string;
};
export type ProjectItem = { label: string; target: Target; focus: Focus };
export type ConversationItem = { id: number; name: string };
export type RunningTask = {
  target: Target;
  focus?: Focus;
  phase?: string;
  task?: TaskState;
};
export type SessionView = {
  conversationId?: string;
  messages: import("../../renderer-contracts").WriterMessage[];
  total: number;
  busy: boolean;
  stream: string;
  phase: string;
  focus?: Focus;
  task?: TaskState;
};
export type ExportResult = { copied?: true; file?: string } | null;
export type RequestOptions = {
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
};
export type RequestResult = { status: number; data: unknown };
export type RendererState = PublicSettings & {
  target?: Target;
  notice: string;
  access: { readOnly: boolean; owner: { host?: string } | null };
  version: string;
  updates: UpdateStatus;
};
export interface WorkspaceChoice extends PublicSettings {
  target: Target;
}

export interface IpcMap {
  "context-settings": { args: [ContextSettings]; result: PublicSettings };
  "context-usage": {
    args: [Target];
    result: Awaited<ReturnType<typeof import("../../session/usage").sessionUsage>>;
  };
  compact: { args: [Target, string]; result: { tokensBefore: number; summary: string } };
  state: { args: []; result: RendererState };
  choose: { args: [Target["mode"]]; result: Target | null };
  workspace: { args: []; result: WorkspaceChoice | null };
  projects: { args: []; result: ProjectItem[] };
  "new-target": { args: [Target["mode"]]; result: Target };
  "new-conversation": { args: [Target]; result: true };
  conversations: { args: [Target]; result: ConversationItem[] };
  export: { args: [Target, Focus, string]; result: ExportResult };
  backup: { args: []; result: { file: string } | null };
  "storage-health": { args: []; result: StorageHealth };
  recover: {
    args: [{ id: string; fingerprint: string }];
    result: { file: string | null; state: unknown } | null;
  };
  diagnostics: { args: []; result: { file: string } | null };
  updates: { args: [string?]; result: UpdateStatus };
  external: { args: [string]; result: void };
  select: { args: [Target]; result: Target };
  view: { args: [Target, number?, number?]; result: SessionView };
  running: { args: []; result: RunningTask[] };
  profiles: { args: []; result: boolean };
  model: { args: [unknown]; result: PublicSettings };
  "model-catalog": {
    args: [keyof ModelSettings, Partial<ModelConnection>, string?];
    result:
      | Awaited<ReturnType<typeof import("../../session/pi-adapter").modelCatalog>>
      | Awaited<ReturnType<typeof import("../../session/pi-adapter").discoverModels>>;
  };
  "test-model": {
    args: [keyof ModelSettings, Partial<ModelConnection>];
    result: { latency: number; model: string };
  };
  appearance: {
    args: [Partial<PublicSettings["appearance"]>];
    result: PublicSettings["appearance"];
  };
  preferences: { args: []; result: string };
  "save-preferences": { args: [string]; result: string };
  "test-search": {
    args: [
      string | undefined,
      import("../../network").SearchProvider,
      import("../../network").SearchMode,
    ];
    result: { results: number; cost?: number };
  };
  search: {
    args: [
      string | undefined,
      import("../../network").SearchProvider?,
      import("../../network").SearchMode?,
    ];
    result: PublicSettings;
  };
  request: { args: [string, RequestOptions?]; result: RequestResult };
  send: { args: [string, Target?, Focus?]; result: true | undefined };
  stop: { args: [Target?]; result: void };
}

export type IpcChannel = keyof IpcMap;
export type IpcArgs<K extends IpcChannel> = IpcMap[K]["args"];
export type IpcResult<K extends IpcChannel> = IpcMap[K]["result"];

import {
  parseMode,
  parseTarget,
  parseFocus,
  parseText,
  parseOperation,
  parseRequestOptions,
  parseAppearance,
  parseLimit,
  parseArchive,
  parseChoice,
  parseRecovery,
  parseExternal,
} from "./validate";
import { parseConnectionInput } from "../../models";
const role = (value: unknown) => parseChoice(value, ["writer", "editor", "planner"] as const);
export const IPC_PARSERS: { [K in IpcChannel]: (args: unknown[]) => IpcArgs<K> } = {
  "context-settings": ([value]) => [parseContextSettings(value)],
  "context-usage": ([target]) => [parseTarget(target)],
  compact: ([target, instructions]) => [parseTarget(target), parseText(instructions)],
  state: () => [],
  choose: ([mode]) => [parseMode(mode)],
  workspace: () => [],
  projects: () => [],
  "new-target": ([mode]) => [parseMode(mode)],
  "new-conversation": ([target]) => [parseTarget(target)],
  conversations: ([target]) => [parseTarget(target)],
  export: ([target, focus, format]) => [
    parseTarget(target),
    parseFocus(focus),
    parseChoice(format, ["copy", "txt", "docx"] as const),
  ],
  backup: () => [],
  "storage-health": () => [],
  recover: ([expected]) => [parseRecovery(expected)],
  diagnostics: () => [],
  updates: ([action]) => [
    action === undefined
      ? undefined
      : parseChoice(action, ["check", "download", "install"] as const),
  ],
  external: ([url]) => [parseExternal(url)],
  select: ([target]) => [parseTarget(target)],
  view: ([target, limit, archive]) => [
    parseTarget(target),
    parseLimit(limit),
    parseArchive(archive),
  ],
  running: () => [],
  profiles: () => [],
  model: ([value]) => [value],
  "model-catalog": ([value, next, action]) => [
    role(value),
    parseConnectionInput(next),
    action === undefined ? undefined : parseChoice(action, ["refresh", "endpoint"] as const),
  ],
  "test-model": ([value, next]) => [role(value), parseConnectionInput(next)],
  appearance: ([next]) => [parseAppearance(next)],
  preferences: () => [],
  "save-preferences": ([text]) => [parseText(text)],
  "test-search": ([key, provider, mode]) => [
    key === undefined ? undefined : parseText(key),
    parseChoice(provider, ["exa", "tavily"] as const),
    parseChoice(mode, ["lite", "auto"] as const),
  ],
  search: ([key, provider, mode]) => [
    key === undefined ? undefined : parseText(key),
    provider === undefined ? undefined : parseChoice(provider, ["exa", "tavily"] as const),
    mode === undefined ? undefined : parseChoice(mode, ["lite", "auto"] as const),
  ],
  request: ([operation, options]) => [parseOperation(operation), parseRequestOptions(options)],
  send: ([text, target, focus]) => [
    parseText(text),
    target === undefined ? undefined : parseTarget(target),
    parseFocus(focus),
  ],
  stop: ([target]) => [target === undefined ? undefined : parseTarget(target)],
};
