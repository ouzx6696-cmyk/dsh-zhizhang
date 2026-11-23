/** 主进程与渲染层共用的会话与写作区类型。 */
import type { Focus, Target } from "./views.js";

export type TaskEndReason = "done" | "cancelled" | "failed";

/** 助手一轮回复的进度（工具调用折叠为步骤）。 */
export type TaskState = {
  id: string;
  name: string;
  completed: string[];
  current: string;
  waiting: string;
  tokens: number;
  cost: number | null;
  startedAt: number;
  endedAt?: number;
};

/** 工具调用的界面显示名由渲染层按 name 取（见 context.ts toolLabel）。 */
export type ToolCallView = {
  name: string;
  isError: boolean;
  summary?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  /** 本条助手回复里调用过的工具（界面折叠成单行）。 */
  tools?: ToolCallView[];
  /** 发起流水线等可打开的结果卡。 */
  result?: ResultCard;
};

/** 助手工具产出的可操作结果（查看 / 对照 / 打开流水线）。 */
export type ResultCard = {
  kind: "run" | "compare" | "chapter" | "article";
  target: Target;
  focus?: Focus;
  runId?: string;
  pipeline?: string;
};
