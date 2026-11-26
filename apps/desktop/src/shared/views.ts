/**
 * IPC 结果与推送里用到的视图类型（主进程产出，渲染层只读）。
 * 写作区命令的结果直接引用 @zhizhang/workbench/contract，这里不建影子类型。
 */
import type { ErrorCode } from "@zhizhang/core/errors";
import type { StaleLock } from "@zhizhang/core/lock";
import type { RunRecord, RunState, UsageTotals } from "@zhizhang/core/pipeline";
import type { PublicSettings, ThinkingLevel } from "./settings.js";
import type { ChatMessage, TaskState } from "./types.js";

export type Mode = "fanqie" | "toutiao";

/** 作用目标：番茄为作品目录，头条为文章目录，拆书库为库根（mode=fanqie）。 */
export interface Target {
  mode: Mode;
  path: string;
  subId?: string;
}

export interface FocusSelection {
  text: string;
  paragraphStart?: number;
  paragraphEnd?: number;
}

export interface ContextMention {
  kind: "chapter" | "entity" | "card" | "source";
  id: string;
  label: string;
}

/** 作者当前关注的位置（随助手消息一起送达，不改变运行中的任务）。 */
export interface Focus {
  chapter?: string;
  candidate?: string;
  article?: string;
  title?: string;
  workTitle?: string;
  source?: "chapter" | "candidate" | "article" | "split";
  dirty?: boolean;
  selection?: FocusSelection;
  mentions?: ContextMention[];
}

export interface RunRef {
  runId: string;
  target: Target;
}

export interface WorkspaceRoots {
  fanqie: string;
  toutiao: string;
  library: string;
}

export interface WorkspaceStatus {
  /** 写作文件夹；未设置时为空串。 */
  root: string;
  configured: boolean;
  readonly: boolean;
  owner?: string;
  roots: WorkspaceRoots;
}

export interface TargetItem {
  target: Target;
  label: string;
  kind: "work" | "article" | "library";
  status?: string;
  updated?: string;
  wordCount?: number;
  chapterCount?: number;
  finalCount?: number;
  pendingBible?: number;
  qaScore?: number;
  genre?: string;
  driver?: string;
  profile?: string;
  tags?: string[];
  pinned?: boolean;
  archived?: boolean;
}

export type UpdateAction = "status" | "check" | "download" | "install";

export type UpdateStatus =
  | { state: "unavailable"; version: string; reason: "unpacked" | "disabled" }
  | { state: "idle" | "checking" | "latest"; version: string }
  | {
      state: "available" | "downloading" | "ready";
      version: string;
      next: string;
      notes?: string;
      percent?: number;
    }
  | { state: "error"; version: string; code: ErrorCode; message: string };

export interface SettingsIssue {
  code: ErrorCode;
  message: string;
  path?: string;
}

export interface AppStateView {
  version: string;
  platform: string;
  settings: PublicSettings;
  /** settings.json 无法解析时给出原因；此时运行在默认设置上，作者可选择重置。 */
  settingsIssue?: SettingsIssue;
  workspace: WorkspaceStatus;
  updates: UpdateStatus;
  recent: TargetItem[];
}

export interface RunSummary {
  id: string;
  kind: string;
  target: Target;
  state: RunState;
  /** 最近一次状态转移原因（例如 budget、author-stop、error）。 */
  reason?: string;
  /** 已完成的阶段 id，按完成顺序。 */
  stages: string[];
  usage: UsageTotals;
  error?: { code: ErrorCode; message: string };
  created: string;
  updated: string;
}

export type RunDetail = RunRecord & { error?: { code: ErrorCode; message: string } };

export interface RunningRow {
  target: Target;
  source: "pipeline" | "assistant";
  runId?: string;
  kind?: string;
  stage?: string;
  since: string;
}

export type WorkflowAction = "pause" | "resume" | "stop" | "retry";
export type WorkflowDecision = "apply" | "discard";

export interface WorkflowStart {
  kind: string;
  request: unknown;
}

export type SessionIntent =
  "chat" | "continue" | "revise" | "review" | "plan" | "check" | "beats" | "diagnose" | "polish";

export interface SessionSend {
  text: string;
  focus?: Focus;
  intent?: SessionIntent;
}

export interface ConversationItem {
  id: string;
  title: string;
  updated: string;
  messages: number;
  current: boolean;
}

export interface SessionView {
  conversationId: string;
  messages: ChatMessage[];
  total: number;
  busy: boolean;
  /** 进行中的助手回复（尚未收尾的增量文本）。 */
  stream: string;
  /** 进行中的助手思考链增量。 */
  thinkingStream?: string;
  task?: TaskState;
}

export interface ContextUsageView {
  tokens: number;
  window: number;
  percent: number;
  messages: number;
  compactAt: number;
}

export interface CompactResult {
  tokensBefore: number;
  tokensAfter: number;
  summary: string;
}

export interface ModelTestInput {
  connectionId: string;
  model: string;
  thinking?: ThinkingLevel;
  /** 未保存的草稿连接：带上即按草稿测试，apiKey 省略时沿用已存密钥。 */
  draft?: import("./settings.js").ConnectionInput;
}

export interface ModelTestResult {
  latencyMs: number;
  model: string;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface ModelCatalogView {
  source: "pi" | "endpoint";
  models: ModelCatalogEntry[];
}

export type ExportFormat = "txt" | "docx" | "md" | "copy";

export interface ExportRequest {
  format: ExportFormat;
  /** 番茄：只导出已定稿章节（缺省 true）。 */
  finalOnly?: boolean;
  /** 头条：导出交稿单而不是最新草稿。 */
  includeDelivery?: boolean;
}

export type ExportResult =
  | { file: string; count: number; downloadUrl?: string; fileName?: string }
  | { copied: true; chars: number; content?: string }
  | null;

export type DiagnosticsResult = {
  file: string;
  downloadUrl?: string;
  fileName?: string;
} | null;

export interface BackupResult {
  dir: string;
  sources: string[];
}

export interface PendingIntentView {
  dir: string;
  id: string;
}

export interface StorageHealth {
  root: string;
  readonly: boolean;
  staleLocks: StaleLock[];
  pendingIntents: PendingIntentView[];
  interruptedRuns: RunSummary[];
}

export type RecoverAction =
  | { kind: "clear-lock"; lockDir: string }
  | { kind: "replay-intents"; dir: string }
  | { kind: "discard-run"; runId: string; target: Target };

export interface OpenedText {
  path: string;
  name: string;
  content: string;
  encoding: "utf-8" | "gbk";
}

export interface FetchedSource {
  url: string;
  date: string;
  text: string;
}

export interface LearningView {
  patterns: Array<{
    signature: string;
    kind: string;
    condition: string;
    change: string;
    count: number;
    promoted: boolean;
    status?: string;
    examples: Array<{ before: string; after: string; chapter?: string }>;
  }>;
  rules: Array<{ id: string; condition: string; change: string; why: string }>;
}
