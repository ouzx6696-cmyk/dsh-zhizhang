import type { Focus, Target } from "../../../context";
import type { WorkspaceContext } from "../../../renderer-contracts";
import type { DesktopState } from "../../state/store";
import type { ChatState } from "../../state/chatStore";
import { desktop } from "../../state/desktop";

type CommandDependencies = {
  name: string;
  args: string;
  context: WorkspaceContext;
  selected: Target | null;
  focus: Focus;
  set: (
    patch: Partial<DesktopState> | ((state: DesktopState) => Partial<DesktopState>),
  ) => void;
  setChat: (
    patch: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
  ) => void;
  sendText: (value: string, snapshot?: Focus) => Promise<void>;
  deliver: (action: string, note?: string) => Promise<void>;
  jump: (target: Target | null, focus?: Focus) => Promise<void>;
  newWork: (mode: "fanqie" | "toutiao", note?: string) => Promise<void>;
  exportFile: (format: string) => Promise<void>;
  loadView: (target: Target, maximum?: number, old?: number) => Promise<void>;
  clearArchive: () => void;
};

export async function runCommand(deps: CommandDependencies) {
  const { name, args, context, selected, focus, set } = deps;
  set({ palette: false, query: "" });
  if (name === "对照采纳")
    return deps.jump(selected, { ...focus, candidate: context.candidate?.id });
  if (name === "补全章纲")
    return deps.sendText(
      "【写作台】读取本书已保存的规划，补齐当前章纲缺项；不要写正文。" + args,
      { ...focus, intent: "plan" },
    );
  if (name === "新书") return deps.newWork("fanqie", args);
  if (name === "续写") return deps.deliver("continue", args);
  if (name === "改本章") return deps.deliver("revise", args);
  if (name === "派编辑") return deps.deliver("review", args);
  if (name === "拆书")
    return deps.sendText(
      "【写作台】拆解以下指定原文或链接。只完成分析，不自动入库或改写本书。" +
        (args || "先请我提供原文片段或链接。"),
      { ...focus, intent: "plan" },
    );
  if (name === "质检")
    return deps.sendText(
      selected?.mode === "toutiao"
        ? "【写作台】对当前文章做质检，回报实际分数、硬闸与未通过项，不自动采用。"
        : "【写作台】对当前章节做表达与伏笔核对，回报值得核对的位置，不自动改稿或定稿。",
      { ...focus, intent: "review" },
    );
  if (name === "交稿") {
    if (selected?.mode === "toutiao") return deps.deliver("continue", args);
    return deps.exportFile("txt");
  }
  if (name === "导出") return deps.exportFile("txt");
  if (name === "新对话") {
    if (!selected) throw new Error("请先打开作品");
    await desktop.newConversation(selected);
    deps.clearArchive();
    deps.setChat({
      archive: undefined,
      archives: await desktop.conversations(selected),
      phase: "新对话已准备，作品保留；下一条指令会自动带入交接。",
    });
    await deps.loadView(selected);
    return;
  }
  throw new Error("未识别的命令，请从命令面板选择");
}
