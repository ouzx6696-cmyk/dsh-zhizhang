import { parseStageCardArgs } from "../../ports/library/input.js";
import { LibraryPort } from "../../ports/index.js";

import { S, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const libraryCardStage = defineTool({
  name: "fanqie_library_card_stage",
  description:
    "【闭环·库 6/9 出卡】暂存卡。v2 模块须 layer+dimension+readerWant/emotionArc/dramaticUnit/replaceables/mustNotCopy/transfer/failWhen+evidence；可选 steps（三步公式）/bannedDiction（反AI腔词表）。文风卡（dimension=prose）另须文风逆向三段 styleMust/styleForbidden/styleSceneAdjust（各≥1 条）+ transferSample（200–300 字迁移试写，原创演示该书文风用到全新内容，禁止复述原书句子）。旧卡仍走 axis+mechanisms+body。下一步：读软警告 → card_accept。",
  properties: {
    title: S("技法卡标题"),
    source: S("来源 sourceId"),
    body: S("分析正文（markdown）"),
    reading_range: S("实际阅读范围"),
    steps: {
      type: "array",
      items: S("一步操作"),
      description: "可选：三步操作公式（第一步/第二步/第三步），供 brief 直接照做",
    },
    bannedDiction: {
      type: "array",
      items: S("禁用词句"),
      description: "可选：反AI腔词表（如 恐怖如斯/空气仿佛凝固）",
    },
    styleMust: {
      type: "array",
      items: S("一条必须贯彻的文风约束"),
      description:
        "文风卡（dimension=prose）必填：必须贯彻——从拆书证据提炼、迁移后仍要执行的硬约束（至少 1 条）",
    },
    styleForbidden: {
      type: "array",
      items: S("一条绝对禁止的写法"),
      description:
        "文风卡（dimension=prose）必填：绝对禁止——该书文风里照搬必然出错或构成抄袭的做法（至少 1 条）",
    },
    styleSceneAdjust: {
      type: "array",
      items: S("一条按场景调节的规则"),
      description:
        "文风卡（dimension=prose）必填：按场景调节——同一文风在不同场景（对话/打斗/抒情）下的松紧变化（至少 1 条）",
    },
    transferSample: S(
      "文风卡（dimension=prose）必填：迁移试写——200–300 字原创片段，演示把该书文风用到全新内容上；禁止复述原书句子",
    ),
    mechanisms: {
      type: "array",
      description: "机制数组：[{name,experience,rebuild,discard,failWhen}]",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: S("机制名"),
          experience: S("原文体验/证据"),
          rebuild: S("如何重建到新作"),
          discard: S("什么可弃"),
          failWhen: S("失败边界"),
        },
        required: ["name", "failWhen"],
      },
    },
    human_feel: {
      type: "object",
      description:
        "craft 轴活人证据：{writerCraft, craftRange, characterState, stateOnPage, allowedEdges, failAsTemplate}；旧 voice/realness 可读迁；禁人设墙",
      additionalProperties: false,
      properties: {
        writerCraft: S("作家写法：叙述口吻/场面取舍/信息怎么漏/节奏或小物"),
        craftRange: S("写法证据出处/阅读范围"),
        characterState: S("这一刻角色状态（慌/赖皮/在算账…），非声纹"),
        stateOnPage: S("状态落纸手法（身体/偏题/半截话等），非台词范本"),
        allowedEdges: S("重造时允许的毛边"),
        failAsTemplate: S("写成齐整范文腔即失败"),
        // legacy aliases accepted by normalizeHumanFeel (also listed for discoverability)
        voice: S("【旧】迁为 stateOnPage；落纸手法证据"),
        voiceRange: S("【旧】迁为 craftRange"),
        realness: S("【旧】迁为 writerCraft"),
      },
    },
    book_craft: {
      type: "object",
      description:
        "craft 续写面（方案A）：{continueWhy, adjacentChange, failAsShortStory}；≠完整创作思维",
      additionalProperties: false,
      properties: {
        continueWhy: S("收束后为何还想翻（过程证据）"),
        adjacentChange: S("相邻单元变了什么"),
        failAsShortStory: S("写成独立短篇闭环即失败"),
      },
    },
    axis: S("硬轴：craft（写作技法→正文）| mind（创作思维→设定/纲）；缺则兼容推断"),
    mind: {
      type: "object",
      description:
        "创作思维（axis=mind 必填）：{sellIntoCost, infoStaging, pressureMachine, debtAndSwap, readerContract, failAsEncyclopedia}",
      additionalProperties: false,
      properties: {
        sellIntoCost: S("卖点如何进能力与代价"),
        infoStaging: S("信息如何分期交付"),
        pressureMachine: S("人物关系如何当压力机"),
        debtAndSwap: S("长线债与换压（章/卷）"),
        readerContract: S("读者合同如何立"),
        failAsEncyclopedia: S("写成百科/设定表/梗概即失败"),
      },
    },
    handoff: {
      type: "object",
      description: "可选交接四项：{purpose, experience, rebuild, discard}",
      additionalProperties: false,
      properties: {
        purpose: S("本卡用途"),
        experience: S("原文体验证据"),
        rebuild: S("如何迁到新作"),
        discard: S("必须丢弃的原作剧情/人名"),
      },
    },
    kind: S("次标签：craft|scene|book（≠axis；axis=mind 才进创作思维轨）"),
    layer: {
      type: "string",
      enum: ["book", "arc", "unit", "chapter", "scene", "line"],
      description: "v2 模块层：book/arc/unit→mind；scene/chapter/line→craft",
    },
    dimension: {
      type: "string",
      enum: ["structure", "character", "rhythm", "hook", "prose", "commercial"],
      description: "v2 模块维度",
    },
    readerWant: S("v2：读者想看什么（具体期待/情绪缺口）"),
    emotionArc: S("v2：情绪走向（建立-延迟-触发-兑现-余波）"),
    dramaticUnit: S("v2：戏剧单元（拿掉专名后的功能）"),
    replaceables: {
      type: "array",
      items: { type: "string" },
      description: "v2：可替换项（身份/场景/道具/目标）",
    },
    mustNotCopy: {
      type: "array",
      items: { type: "string" },
      description: "v2：不可照搬（原句/专名/独特事件链）",
    },
    transfer: S("v2：怎么迁到新作"),
    failWhen: S("v2：失败边界"),
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { quote: S("原文引文"), chapter: S("章号") },
        required: ["quote", "chapter"],
      },
      description: "v2：证据 [{quote,chapter}]，accept 前逐条回溯",
    },
    tags: {
      type: "array",
      description: "可选标签",
      items: { type: "string" },
    },
    working_dir: WORKING_DIR,
  },
  required: ["title", "source", "body", "mechanisms"],
  async execute(args, exec) {
    const input = parseStageCardArgs(args);
    const { title, sourceId, axis } = input;
    const paths = await openLibrary(exec, args, true);
    const { candId, warnings } = await LibraryPort.stageCard(paths, input);
    const lines = [
      `卡候选已暂存：${candId}`,
      `- 标题：${title}`,
      `- 来源：${sourceId}`,
      `- axis：${axis || "（推断）"}`,
      `- 尚未入库；确认后 fanqie_library_card_accept`,
    ];
    if (warnings.length) {
      lines.push("", "【软警告】");
      for (const w of warnings) lines.push(`- ${w}`);
    }
    lines.push(
      "",
      "下一步 7/9：逐条处理上面软警告（「没读」类不能忽略）→ fanqie_library_card_accept(candidate)",
    );
    return lines.join("\n");
  },
});
