import type { AgentSession, SessionManager } from "./pi-adapter";
import type { Focus, Target } from "../context";
import type { FanqieConfig } from "../../../../packages/fanqie/src/config";
import type { ToutiaoConfig } from "../../../../packages/toutiao/src/config";

export type Task = import("../renderer-contracts").TaskState;

export type SessionEntry = {
  session: AgentSession;
  target: Target;
  focus: Focus;
  phase: string;
  profile?: string;
  task: Task;
};

export type SessionOptions = { toutiao?: ToutiaoConfig; fanqie?: FanqieConfig };

export type SessionExtras = {
  preferences?: () => Promise<string>;
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
