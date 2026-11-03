import type { Focus, Target } from "./context";
import type { WorkspaceContext } from "./renderer-contracts";
import type { DesktopState } from "./renderer/state/store";
import type { ChatState } from "./renderer/state/chatStore";
import { desktop } from "./renderer/state/desktop";

type CommandDependencies = {
  name: string;
  args: string;
  context: WorkspaceContext;
  selected: Target | null;
  focus: Focus;
  set: (patch: Partial<DesktopState> | ((state: DesktopState) => Partial<DesktopState>)) => void;
  setChat: (patch: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void;
  sendText: (value: string, snapshot?: Focus) => Promise<void>;
  deliver: (action: string, note?: string) => Promise<void>;
  jump: (target: Target | null, focus?: Focus) => Promise<void>;
  newWork: (mode: "fanqie" | "toutiao", note?: string) => Promise<void>;
  exportFile: (format: string) => Promise<void>;
  loadView: (target: Target, maximum?: number, old?: number) => Promise<void>;
  changeView: (view: string) => void;
  canLeave: () => boolean;
  clearArchive: () => void;
};
const HANDLERS: Record<string, (deps: CommandDependencies) => Promise<unknown>> = {
  对照采纳: async (deps: CommandDependencies) => {
    const { context, selected, focus } = deps;
    return deps.jump(selected, { ...focus, candidate: context.candidate?.id });
  },
  补全章纲: async (deps: CommandDependencies) => {
    const { args, focus } = deps;
    return deps.sendText("【写作台】读取本书已保存的规划，补齐当前章纲缺项；不要写正文。" + args, {
      ...focus,
      intent: "plan",
    });
  },
  新书: async (deps: CommandDependencies) => {
    const { args } = deps;
    return deps.newWork("fanqie", args);
  },
  续写: async (deps: CommandDependencies) => {
    const { args } = deps;
    return deps.deliver("continue", args);
  },
  改本章: async (deps: CommandDependencies) => {
    const { args } = deps;
    return deps.deliver("revise", args);
  },
  派编辑: async (deps: CommandDependencies) => {
    const { args } = deps;
    return deps.deliver("review", args);
  },
  拆书: async (deps: CommandDependencies) => {
    const { args, focus } = deps;
    return deps.sendText(
      "【写作台】拆解以下指定原文或链接。只完成分析，不自动入库或改写本书。" +
        (args || "先请我提供原文片段或链接。"),
      { ...focus, intent: "plan" },
    );
  },
  质检: async (deps: CommandDependencies) => {
    const { selected, focus } = deps;
    return deps.sendText(
      selected?.mode === "toutiao"
        ? "【写作台】对当前文章做质检，回报实际分数、硬闸与未通过项，不自动采用。"
        : "【写作台】对当前章节做表达与伏笔核对，回报值得核对的位置，不自动改稿或定稿。",
      { ...focus, intent: "review" },
    );
  },
  交稿: async (deps: CommandDependencies) => {
    const { args, selected } = deps;
    if (selected?.mode === "toutiao") return deps.deliver("continue", args);
    return deps.exportFile("txt");
  },
  导出: async (deps: CommandDependencies) => {
    return deps.exportFile("txt");
  },
  新对话: async (deps: CommandDependencies) => {
    const { selected } = deps;
    if (!selected) throw new Error("请先打开作品");
    if (!deps.canLeave()) return;
    await desktop.newConversation(selected);
    deps.clearArchive();
    deps.setChat({
      archive: undefined,
      archives: await desktop.conversations(selected),
      phase: "新对话已准备，作品保留；下一条指令会自动带入交接。",
    });
    await deps.loadView(selected);
    return;
  },
};
const COMMAND_DESCRIPTIONS: { id: string; label: string; hint: string; palette?: boolean }[] = [
  {
    id: "新书",
    label: "创建新书",
    hint: "先创建作品，再做开书规划",
  },
  {
    id: "续写",
    label: "续写下一章／推进文章",
    hint: "按当前作品状态继续",
  },
  {
    id: "改本章",
    label: "按审读回报修改",
    hint: "针对当前章节或文章出修订稿",
  },
  {
    id: "派编辑",
    label: "派独立编辑审读",
    hint: "使用编辑角色的模型与新上下文",
  },
  {
    id: "拆书",
    label: "拆解原文或链接",
    hint: "分析指定材料，不自动入库",
  },
  {
    id: "质检",
    label: "检查当前稿件",
    hint: "运行已有检查工具",
  },
  {
    id: "交稿",
    label: "准备交稿",
    hint: "头条交稿单／长篇导出检查",
  },
  {
    id: "导出",
    label: "导出稿件",
    hint: "TXT、DOCX 或复制标题与正文",
  },
  {
    id: "新对话",
    label: "新对话，保留作品",
    hint: "旧对话仍可查阅，重新交接当前作品",
  },

  { id: "对照采纳", label: "对照采纳", hint: "核对当前候选稿", palette: false },
  { id: "补全章纲", label: "补全章纲", hint: "补齐当前章纲缺项", palette: false },
];

export const COMMANDS = COMMAND_DESCRIPTIONS.map((command) => ({
  ...command,
  run: HANDLERS[command.id],
}));
export function getCommand(id: string) {
  const command = COMMANDS.find((command) => command.id === id);
  if (!command) throw new Error("未识别的命令，请从命令面板选择");
  return command;
}
export async function runCommand(deps: CommandDependencies) {
  deps.set({ palette: false, query: "" });
  return getCommand(deps.name).run(deps);
}
