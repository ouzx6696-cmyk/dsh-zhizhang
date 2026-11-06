import type { AgentSession, SessionManager } from "./pi-adapter";
import type { Focus, Target } from "../context";
import type { DiagnosticFields } from "../../../../packages/core/src/diagnostics";
import type { FanqieConfig } from "../../../../packages/fanqie/src/config";
import type { ToutiaoConfig } from "../../../../packages/toutiao/src/config";

export type Task = import("../renderer-contracts").TaskState & {
  usage: import("../renderer-contracts").TokenUsage;
};

/** 最近一次 v2 交接的方法包摘要（tracker 从实际进入上下文的任务 prompt 解析），供方法包面板展示。 */
export type HandoffSummary = {
  intentSource: "focus" | "state";
  intent: string;
  methods: { id: string; bytes: number; injected: boolean; trimmed: boolean }[];
};

export type SessionEntry = {
  session: AgentSession;
  target: Target;
  focus: Focus;
  phase: string;
  methods: Map<string, { id: string; profile: string; hash: string }>;
  handoff?: HandoffSummary;
  profile?: string;
  task: Task;
};

export type SessionOptions = { toutiao?: ToutiaoConfig; fanqie?: FanqieConfig };

export type SessionExtras = {
  context?: () => import("../context-settings").ContextSettings;
  preferences?: () => Promise<string>;
  searchProvider?: () => import("../network").SearchProvider;
  searchMode?: () => import("../network").SearchMode;
  searchKey?: () => string;
  log?: (event: string, fields: DiagnosticFields) => void;
};

export type HistoryCache = Map<string, { stamp: string; manager: SessionManager }>;

export type AuthorAction = {
  operation: string;
  article?: string;
  chapter?: string;
  candidate?: string;
  revision?: string | number;
  status?: string;
  profile?: string;
};
