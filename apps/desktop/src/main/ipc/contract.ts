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
  messages: any[];
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
export type RequestResult = { status: number; data: any };
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
    args: [unknown];
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
  "model-catalog": { args: [keyof ModelSettings, ModelConnection, string?]; result: any };
  "test-model": {
    args: [keyof ModelSettings, ModelConnection];
    result: { latency: number; model: string };
  };
  appearance: {
    args: [Partial<PublicSettings["appearance"]>];
    result: PublicSettings["appearance"];
  };
  preferences: { args: [string?]; result: string };
  search: { args: [string]; result: PublicSettings };
  request: { args: [string, RequestOptions?]; result: RequestResult };
  send: { args: [string, Target?, Focus?]; result: true | undefined };
  stop: { args: [Target?]; result: void };
}

export type IpcChannel = keyof IpcMap;
export type IpcArgs<K extends IpcChannel> = IpcMap[K]["args"];
export type IpcResult<K extends IpcChannel> = IpcMap[K]["result"];
