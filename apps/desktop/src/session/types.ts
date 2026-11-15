import type { AgentSession, SessionManager } from "./pi-adapter";
import type { Focus, Target } from "../context";
import type { DiagnosticFields } from "@zhizhang/core";
import type { FanqieConfig } from "@zhizhang/fanqie";
import type { ToutiaoConfig } from "@zhizhang/toutiao";

export type Task = import("../shared/types").TaskState & {
  usage: import("../shared/types").TokenUsage;
};

/** 最近一次 v2 交接的方法包摘要（tracker 从实际进入上下文的任务 prompt 解析），供方法包面板展示。 */
type HandoffSummary = {
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
  /** 章级会话判定用：该会话最近一次接受任务的章节（fanqie 且 focus.chapter 存在时更新）。 */
  lastChapter?: string;
  task: Task;
};

export type SessionOptions = { toutiao?: ToutiaoConfig; fanqie?: FanqieConfig };

export type SessionExtras = {
  engine?: () => import("@zhizhang/core").EngineSettings;
  context?: () => import("../context-settings").ContextSettings;
  preferences?: () => Promise<string>;
  /** 追加作者约束的写入口（writer_remember 用；与 save-preferences IPC 共用 Settings.savePreferences）。 */
  savePreferences?: (text: string) => Promise<void>;
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
