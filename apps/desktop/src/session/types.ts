import type { AgentSession, SessionManager } from "./pi-adapter";
import type { Focus, Target } from "../context";
import type { DesktopEvent } from "../renderer-contracts";
import type { FanqieConfig } from "../../../../packages/fanqie/src/config";
import type { ToutiaoConfig } from "../../../../packages/toutiao/src/config";

export type Task = {
  name: string;
  completed: string[];
  current: string;
  waiting: string;
  tokens: number;
  cost: number;
  startedAt: number;
};

export type SessionEntry = {
  session: AgentSession;
  target: Target;
  focus: Focus;
  phase: string;
  task: Task;
};

export type SessionOptions = { toutiao?: ToutiaoConfig; fanqie?: FanqieConfig };

export type SessionExtras = {
  preferences?: () => Promise<string>;
  searchKey?: () => string;
  log?: (
    event: string,
    fields: Record<string, string | number | boolean | undefined>,
  ) => void;
};

export type HistoryCache = Map<
  string,
  { stamp: string; manager: SessionManager }
>;

export type SessionView = {
  messages: unknown[];
  total: number;
  busy: boolean;
  stream: string;
  phase: string;
  focus?: Focus;
  task?: Task;
};

export type AuthorAction = {
  operation: string;
  article?: string;
  chapter?: string;
  candidate?: string;
  revision?: string | number;
  status?: string;
  profile?: string;
};

export type SessionEmitter = (event: DesktopEvent) => void;
export type SessionConfirmer = (
  text: string,
  signal?: AbortSignal,
) => Promise<boolean>;
