import type { AgentSession, SessionManager } from "./pi-adapter";
import type { Focus, Target } from "../context";
import type { FanqieConfig } from "../../../../packages/fanqie/src/config";
import type { ToutiaoConfig } from "../../../../packages/toutiao/src/config";

export type Task = import("../renderer-contracts").TaskState & {
  usage: import("../renderer-contracts").TokenUsage;
};

export type SessionEntry = {
  session: AgentSession;
  target: Target;
  focus: Focus;
  phase: string;
  methods: Map<string, { id: string; profile: string; hash: string }>;
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
  log?: (event: string, fields: Record<string, string | number | boolean | undefined>) => void;
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
