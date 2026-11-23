/**
 * 助手提示词：系统提示按模式与作品构造；渲染层只发意图 {intent, text, focus}，
 * 选区、@引用与结构化指令模板在这里拼，不在界面里拼。
 */
import type { Focus, RunSummary, SessionIntent, Target } from "../shared/views.js";

const COMMON = [
  "你是织章写作台里的写作助手，服务于一位中文作者。",
  "你的能力边界：可以读取作品材料（章节、候选稿、设定集、学习偏好、拆书参考卡、文章、来源、台账、质检报告、方法），可以发起流水线或打开对照视图；",
  "你没有、也不能直接改写正文、候选稿、设定集或文章状态。需要改稿时，发起相应流水线，产物会作为候选交给作者决定是否采纳。",
  "先读后说：回答涉及具体章节或文章时，先用工具读取，再给出判断；不要编造材料里没有的内容。",
  "共创与结构化交接：当与作者敲定剧情节拍、必须保留原句或规避点后，发起 fanqie_start_chapter 时请把共识写入 brief 字段传入流水线。",
  "发起流水线前，用一句话说明要发起什么、为什么；发起后提示作者可直接在右栏查看实时进度。",
  "回答使用简体中文，简洁、具体，给出可操作的建议。",
];

const MODE_RULES: Record<Target["mode"], string[]> = {
  fanqie: [
    "当前模式：番茄长篇。连续性的唯一真源是设定集；判断人物状态、伏笔、知情关系时先查设定集视图。",
    "写新章用 fanqie_start_chapter（可附带 brief 结构化任务单）；改已有章节用 fanqie_start_revise；独立审读用 fanqie_start_review；全书体检用 fanqie_start_health。",
    "对比候选稿变化时先用 fanqie_diff_candidate；查参考卡与个人风格偏好用 fanqie_list_library_cards 与 fanqie_read_learning。",
    "定稿与采纳候选只能由作者在界面上完成。",
  ],
  toutiao: [
    "当前模式：今日头条图文。标题、质检分数线与交稿末句等业务规则由规则脚本裁定，你不要自行改口径。",
    "推进文章用 toutiao_start_article；读取质检明细用 toutiao_read_qa_report；对比两版草稿用 toutiao_diff_drafts。",
    "验收、交稿与状态变更只能由作者在界面上完成；避免与台账里同一内容线最近文章重复开头式和结尾式。",
  ],
};

const INTENT_TEMPLATES: Record<SessionIntent, string> = {
  chat: "",
  continue:
    "【意图：推进】按当前作品进度判断下一步（缺章纲先补章纲，有章纲则写下一章或推进文章），必要时附带结构化 brief 发起流水线。",
  revise:
    "【意图：修改】读取当前稿件与最近审读/质检意见，归纳逐条问题与改法，发起定向修订流水线，不要直接输出整章改写。",
  review: "【意图：审读】派独立编辑审读当前稿件（发起审读流水线），并说明审读侧重点。",
  plan: "【意图：规划】读取已有规划与设定集，指出缺口并给出补齐建议；不要写正文。",
  check: "【意图：检查】检查当前稿件的表达、连续性与伏笔，列出值得核对的位置，不自动改稿或定稿。",
  beats:
    "【意图：分场共创】基于前文交接与设定集，先提出 2–3 套分场节拍方案（标出冲突与章末钩子）供作者拍板，不要直接动笔写正文。",
  diagnose:
    "【意图：深度诊断】读取当前稿件、审读意见或质检报告，按严重度列出带原文引用的问题清单与可执行的修订指令。",
  polish:
    "【意图：局部润色规划】针对作者选中的片段，分析节奏与措辞问题，给出 2 种不同风格的局部示范句，并询问是否按此发起定向修订。",
};

const MENTION_KIND_LABEL = {
  chapter: "章节",
  entity: "设定",
  card: "技法卡",
  source: "来源",
} as const;

export function systemPrompt(input: {
  target: Target;
  title?: string;
  preferences: string;
  readonly: boolean;
}): string {
  const lines = [...COMMON, ...MODE_RULES[input.target.mode]];
  if (input.title) lines.push(`当前作品：《${input.title}》。`);
  if (input.readonly) {
    lines.push("写作文件夹当前处于只读模式：不要发起任何流水线，只做阅读与建议。");
  }
  const preferences = input.preferences.trim();
  if (preferences) lines.push("作者的长期偏好（始终遵守）：", preferences);
  return lines.join("\n");
}

function focusLine(focus: Focus | undefined): string {
  if (!focus) return "";
  const parts: string[] = [];
  if (focus.chapter) parts.push(`章节 ${focus.chapter}`);
  if (focus.candidate) parts.push(`候选稿 ${focus.candidate}`);
  if (focus.article) parts.push(`文章 ${focus.article}`);
  if (focus.title) parts.push(`标题「${focus.title}」`);
  if (focus.source === "split") parts.push("正在对照正文与候选稿");
  if (focus.dirty) parts.push("作者有未保存的修改（以磁盘内容为准，提醒作者先保存）");

  const blocks: string[] = [];
  if (parts.length) blocks.push(`【作者当前位置】${parts.join("；")}`);
  if (focus.mentions?.length) {
    const refs = focus.mentions
      .map((m) => `@${MENTION_KIND_LABEL[m.kind]}:${m.label}(${m.id})`)
      .join("、");
    blocks.push(`【挂载引用材料】${refs}（请优先使用工具核对这些引用后再作答）`);
  }
  if (focus.selection?.text.trim()) {
    const range =
      focus.selection.paragraphStart !== undefined
        ? `（第 ${focus.selection.paragraphStart + 1} 段${focus.selection.paragraphEnd !== undefined && focus.selection.paragraphEnd !== focus.selection.paragraphStart ? `–第 ${focus.selection.paragraphEnd + 1} 段` : ""}）`
        : "";
    blocks.push(`【作者划选片段${range}】\n${focus.selection.text.trim().slice(0, 1800)}`);
  }
  return blocks.join("\n\n");
}

/** 作者消息在送给模型前的完整文本：意图模板 + 当前位置/选区/@引用 + 原话。 */
export function userPrompt(
  text: string,
  intent: SessionIntent | undefined,
  focus: Focus | undefined,
): string {
  return [INTENT_TEMPLATES[intent ?? "chat"], focusLine(focus), text.trim()]
    .filter(Boolean)
    .join("\n\n");
}

/** 流水线结束/待作者裁决时，向会话注入结构化简报（零额外模型调用）。 */
export function formatRunDebrief(run: RunSummary): string {
  const stageTrail = run.stages.length ? run.stages.join(" → ") : "无已完成阶段";
  const tokens = run.usage.input + run.usage.output;
  if (run.state === "awaiting-author") {
    return [
      `【流水线交付简报】任务 ${run.kind}（${run.id}）已完成并等待你裁决。`,
      `- 阶段轨迹：${stageTrail}`,
      `- 资源消耗：${tokens.toLocaleString("zh-CN")} tokens`,
      "- 下一步：你可以在中栏打开段落对照决定全章或局部采纳，也可以直接让我分析候选稿改动或发起下一轮定向修订。",
    ].join("\n");
  }
  const errLine = run.error ? `- 失败原因：${run.error.message}（${run.error.code}）` : "";
  return [
    `【流水线未完成简报】任务 ${run.kind}（${run.id}）状态为 ${run.state}。`,
    `- 已完成阶段：${stageTrail}`,
    errLine,
    "- 你可以点击重试，或直接告诉我需要调整的约束后重新发起。",
  ]
    .filter(Boolean)
    .join("\n");
}

export const COMPACT_SYSTEM = [
  "把下面的写作助手对话压缩成一份结构化创作交接摘要，供后续对话继续使用。",
  "必须分三节输出（简体中文，总计不超过 650 字）：",
  "1. 【已定创作决策】：已敲定的剧情走向、分场节拍、人物动机与标题选择；",
  "2. 【未决事项与问题】：尚待核查的设定冲突、审读/质检遗留项与下一步计划；",
  "3. 【作者风格与约束】：本轮明确提出的保留句、禁忌套路与口吻偏好。",
  "删去寒暄、重复内容与工具原始输出。",
].join("\n");
