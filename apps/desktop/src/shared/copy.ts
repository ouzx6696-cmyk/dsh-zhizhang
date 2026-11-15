import { COPY as UI_COPY, t as uiT, type CopyKey } from "@zhizhang/ui/copy";

export { ERROR_COPY, type CopyKey } from "@zhizhang/ui/copy";
export const uiCopy = UI_COPY;
export const tUi = uiT;

export const API_LABELS: Record<string, string> = {
  "openai-completions": "OpenAI 兼容（对话）",
  "openai-responses": "OpenAI 响应接口",
  "anthropic-messages": "Anthropic 消息接口",
  "google-generative-ai": "Google 生成接口",
};

export const CRASH_COPY = {
  title: "界面发生异常",
  hint: "已保存的稿件和设置不会丢失，请重新加载界面。",
  reload: "重新加载",
  rejected: "操作未完成：",
} as const;

export const UNLOAD_COPY = {
  title: "有未保存的修改",
  message: "当前仍有未保存的修改或进行中的任务，确定要离开吗？",
  detail: "未保存的正文或设置修改可能会丢失。",
  stay: "留在此页",
  leave: "仍然离开",
} as const;

export const AGENT_COPY = {
  roleAssistant: "助手",
  replied: "助手已回复：",
  log: "对话记录",
  queueTitle: "待发送队列",
  queued: "排队中",
  stopLabel: "停止当前任务",
  stop: UI_COPY["workflow.action.stop"],
  send: "发送",
  queueSend: "加入队列",
  contextTitle: "上下文状态",
  contextCompacting: "正在整理上下文",
  contextUnknown: "上下文用量未知",
  contextWindow: "上下文窗口：",
  contextAuto: "自动整理阈值：",
  contextAutoOff: "自动整理：关闭",
  contextTask: "当前任务",
  contextSession: "当前会话",
  contextSettings: "上下文设置",
  contextSettingsHint: "可在设置中调整自动整理阈值与方法注入策略。",
  contextDetails: "展开详情",
  stepDone: "已完成",
  stepCurrent: "进行中",
  stepPending: "待执行",
  estimated: "估算费用 ",
  queuedCount: "还有 ",
  queuedUnit: " 条待发送",
  statusArchive: "当前为历史存档（只读）",
  statusReadOnly: "当前工作区只读",
  statusNoWork: "请先打开或创建作品",
  statusNoModel: "请先在设置中配置模型",
  statusRunning: "正在执行：",
  statusLast: "上次使用：",
  statusReady: "就绪：",
} as const;

export const WORKFLOW_COPY = {
  progress: "进度",
  stageCount: (done: number, total: number) => `${done}/${total} 阶段`,
  elapsed: "耗时",
  cost: "费用",
  usage: "用量",
  budget: "预算",
  budgetDetail: (used: string, total: string) => `${used} / ${total}`,
  openSettings: "打开设置",
  unresolvedTitle: "仍有未决事项",
  cancel: UI_COPY["workflow.action.stop"],
  retry: UI_COPY["workflow.action.retry"],
  discard: "放弃任务",
  retryHint: "可点击重试从最近检查点继续。",
  showLess: "收起",
  showFull: "展开全文",
  chars: (n: number) => `${n} 字`,
  resolved: "已解决",
  issue: { impact: "影响", fix: "建议改法" },
  noIssues: "未发现阻断性问题。",
  suggestions: "改进建议",
  winner: { A: "优选 A 稿", B: "优选 B 稿", tie: "两稿相当" } as Record<string, string>,
  abandon: { A: "舍弃 A 稿", B: "舍弃 B 稿" },
  recommended: (w: string) => `推荐：${w}`,
  duel: (l: number, r: number) => `对比 ${l} vs ${r}`,
  duelWinner: (w: number | null) => (w === null ? "平局" : `胜出：${w}`),
  claimKind: { fact: "事实", quote: "引述", inference: "推断" } as Record<string, string>,
  fields: {
    scene: { location: "地点", time: "时间", goal: "目标", conflict: "冲突" },
    source: { attribution: "来源归属" },
    extract: { summary: "摘要", hook: "钩子", emotion: "情绪" },
    audit: { continuity: "连贯性", pacing: "节奏", voice: "文风" },
    outline: { title: "章名", summary: "章纲", goal: "本章目标" },
    blueprint: { premise: "核心梗", arc: "主线", tone: "基调" },
    foundation: { setting: "背景", protagonist: "主角", conflict: "核心矛盾" },
  },
  qa: { pass: "质检通过", fail: "质检未过", score: "得分", gates: "硬闸", warnings: "提醒" },
  emotion: (e: unknown) => `情绪：${String(e ?? "平稳")}`,
  fact: (s: string, v: string) => `${s}：${v}`,
  delivery: { open: "仍有待确认项", closed: "已闭环" },
  candidates: (n: number) => `共 ${n} 份候选`,
  titles: "备选标题",
  devDetails: "阶段运行详情",
  attempts: (n: number) => `尝试 ${n} 次`,
  localStep: "本地校验",
  phase: { done: "已完成", active: "进行中", pending: "待执行", failed: "失败" } as Record<
    string,
    string
  >,
  vote: (i: number) => `评审 #${i + 1}`,
  voteGroup: (i: number) => `第 ${i} 组评审`,
  stages: "流水线阶段",
  nextStage: "下一阶段",
  chapterFailed: "读取章节失败",
  chapterEmpty: "暂无章节",
  chapterLoading: "加载章节中…",
  chapterOption: (pos: number, title: string, status: string) => `第${pos}章 ${title}（${status}）`,
  expand: "展开面板",
  collapse: "收起面板",
  widen: "加宽面板",
  narrow: "恢复宽度",
  views: "视图",
  cancelConfirm: "停止当前流水线任务？已完成阶段会保留。",
  keepRunning: "继续运行",
  replaceConfirm: "已有运行中的任务，是否停止并启动新任务？",
  replaceStart: "停止并启动",
  keepPrevious: "保留原任务",
  previousDone: "上一任务已完成",
  previousStopped: "上一任务已停止",
  backToPrevious: "返回上一任务",
  historyStages: (n: number) => `${n} 个阶段`,
  historyOpen: "查看详情",
  historyBack: "返回列表",
  historyEmpty: "暂无流水线历史记录。",
  noPending: "暂无待确认状态。",
  draftNumber: (n: number) => `候选稿 #${n}`,
  guidance: {
    budget: "已达预算上限，请检查设置或手动继续。",
    network: "网络连接异常，请检查模型服务或代理。",
    auth: "鉴权失败，请核对模型密钥。",
  } as Record<string, string>,
  ledgerQueued: "定稿记账已入队",
} as const;

export function taskEndCopy(reason: string): string {
  if (reason === "done") return "任务已完成";
  if (reason === "cancelled") return "任务已停止";
  if (reason === "failed") return "任务未完成";
  return "任务已结束";
}

export function formatDateTime(ts: number | string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function formatCount(n: number): string {
  return n.toLocaleString("zh-CN");
}

export function formatTokens(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(cost: number): string {
  if (!(cost > 0)) return "$0.00";
  return `$${cost.toFixed(4)}`;
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export const DESKTOP_COPY = new Proxy(
  {
    "app.name": UI_COPY["app.name"],
    "shell.tab.assistant": UI_COPY["shell.tab.assistant"],
    "shell.tab.pipeline": UI_COPY["shell.tab.pipeline"],
    "shell.tab.chapter": UI_COPY["shell.tab.chapter"],
    "shell.menu.export": UI_COPY["shell.menu.export"],
    "workflow.awaiting_author": UI_COPY["workflow.awaiting_author"],
    "workflow.action.pause": UI_COPY["workflow.action.pause"],
    "workflow.action.resume": UI_COPY["workflow.action.resume"],
    "workflow.action.stop": UI_COPY["workflow.action.stop"],
    "workflow.action.retry": UI_COPY["workflow.action.retry"],
    "fanqie.action.finalize": UI_COPY["fanqie.action.finalize"],
    "fanqie.action.accept": UI_COPY["fanqie.action.accept"],
    "toutiao.action.deliver": UI_COPY["toutiao.action.deliver"],
    "settings.title": UI_COPY["settings.title"],
    "settings.unsaved": UI_COPY["settings.unsaved"],
    appText1: "正在启动织章…",
    appText2: "【写作台】请规划下一章大纲并准备开写。",
    appText3: "欢迎使用织章",
    appText4: "选择或新建一本番茄长篇或今日头条文章目录，开始写作。",
    appText5: "开始配置工作区",
    notices: "通知",
    inspector: UI_COPY["shell.tab.chapter"],
    pfButton: "方法方案",
    sidebarTabs: "右侧停靠栏",
    modelList: "模型列表",
    ttLedgerTitle: "文章台账",
    ttLedgerEmpty: "暂无头条文章，点击新建开始创作。",
    ttLedgerRev: "版本",
    ttLedgerQa: "质检",
    ttLedgerUpdated: "更新时间",
    ttLedgerOpen: "打开",
    workflowBook: "本书规划",
    workflowChapter: "章节写作",
    workflowArticle: "文章写作",
    workflowLedger: "定稿记账",
    workflowRunning: "进行中",
    workflowPaused: "已暂停",
    workflowFailed: "未完成",
    workflowReady: UI_COPY["workflow.awaiting_author"],
    workflowStart: "开始新任务",
    workspaceLayoutText1: "默认方案",
    workspaceLayoutText2: "当前方案：",
    workspaceLayoutText3: "编辑方法方案",
    workspaceLayoutText4: "文章",
    workspaceLayoutText5: "切换左侧章节导航",
    workspaceLayoutText6: "关闭右侧栏",
    workspaceLayoutText7: "收起右侧栏",
    workspaceLayoutText8: "关闭方法方案",
    rightDockSplit: "上下分屏",
    rightDockTabs: "标签页模式",
    focusModeLabel: "专注模式",
  } as Record<string, string>,
  {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop in UI_COPY) return UI_COPY[prop as CopyKey];
      return prop;
    },
  },
);

export function tDesktop(key: string): string {
  if (key in UI_COPY) return UI_COPY[key as CopyKey];
  return DESKTOP_COPY[key] ?? key;
}
