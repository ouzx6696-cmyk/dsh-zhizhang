/** Library pillar — import / dissect / stage / accept / search technique cards. */
import path from "node:path";
import { stat } from "node:fs/promises";
import {
  LibraryPort,
  coerceAxis,
  formatHumanFeelBlock,
  formatBookCraftBlock,
  formatMindBlock,
  formatHandoffBlock,
} from "../lib/ports/index.js";
import { ensureStorage, listLocalBooks, sessionCwd } from "../lib/store.js";
import { asString, config, fail } from "./context.js";
import { S, WORKING_DIR } from "./schema.js";
import { defineTool, type ToolDef } from "./types.js";

async function openLibrary(exec: unknown, args: Record<string, unknown>) {
  const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
  await LibraryPort.ensureLibrary(paths);
  return paths;
}

/**
 * Resolve a book file: absolute as-is, relative against the session cwd first,
 * then against the configured local shelf (sourceRoot). Unresolved names fall
 * through so importSource reports its normal file_read_failed.
 */
async function resolveBookFile(
  paths: { sourceRoot: string },
  exec: unknown,
  raw: string | undefined,
): Promise<string | undefined> {
  if (!raw || path.isAbsolute(raw)) return raw;
  const cwd = sessionCwd(exec);
  const candidates = [path.resolve(cwd, raw)];
  if (paths.sourceRoot) candidates.push(path.resolve(paths.sourceRoot, raw));
  for (const cand of candidates) {
    try {
      if ((await stat(cand)).isFile()) return cand;
    } catch {
      /* try next */
    }
  }
  return raw;
}

export function libraryTools(): ToolDef[] {
  return [
    defineTool({
      name: "zhizhang_library_import",
      description:
        "【闭环·库】导入小说原文到拆书库。传 text 或 file（file 可写本地书源目录里的文件名）。不拆书、不写卡。下一步：library_dissect_brief。",
      properties: {
        title: S("书名（必填）"),
        author: S("可选作者"),
        text: S("原文全文（与 file 二选一）"),
        file: S("原文文件路径（相对 cwd / 本地书源 / 绝对路径；与 text 二选一）"),
        reading_range: S("可选：实际阅读范围说明"),
        working_dir: WORKING_DIR,
      },
      required: ["title"],
      async execute(args, exec) {
        const title = asString(args, "title", { required: true })!;
        const paths = await openLibrary(exec, args);
        const fileResolved = await resolveBookFile(paths, exec, asString(args, "file"));
        const result = await LibraryPort.importSource(paths, {
          title,
          author: asString(args, "author"),
          text: asString(args, "text", { trim: false }),
          file: fileResolved,
          readingRange: asString(args, "reading_range"),
          exec,
        });
        return [
          `已导入「${title}」→ sourceId=${result.sourceId}`,
          `- 字数：${result.charCount}`,
          `- 正文：library/sources/${result.excerptPath}`,
          "",
          "下一步（闭环）：zhizhang_library_dissect_brief → card_stage(axis) → card_accept → library_combo_suggest",
        ].join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_library_dissect_brief",
      description:
        "【闭环·库】拆书简报：双轴 craft|mind 口令 + 摘录 + analyze。不代写。下一步：card_stage(axis) → card_accept。",
      properties: {
        source: S("sourceId（library_import 返回）"),
        max_chars: { type: "integer", description: "摘录上限（默认 12000）" },
        working_dir: WORKING_DIR,
      },
      required: ["source"],
      async execute(args, exec) {
        const sourceId = asString(args, "source", { required: true })!;
        const paths = await openLibrary(exec, args);
        const maxChars =
          typeof args.max_chars === "number" ? args.max_chars : undefined;
        return LibraryPort.dissectBrief(paths, sourceId, { maxChars });
      },
    }),

    defineTool({
      name: "zhizhang_library_card_stage",
      description:
        "【闭环·库】暂存卡。须 mechanisms+body+axis=craft|mind。craft→写法+状态；mind→创作思维。百科/声纹硬拒。下一步：card_accept。",
      properties: {
        title: S("技法卡标题"),
        source: S("来源 sourceId"),
        body: S("分析正文（markdown）"),
        reading_range: S("实际阅读范围"),
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
        tags: {
          type: "array",
          description: "可选标签",
          items: { type: "string" },
        },
        working_dir: WORKING_DIR,
      },
      required: ["title", "source", "body", "mechanisms"],
      async execute(args, exec) {
        const title = asString(args, "title", { required: true })!;
        const sourceId = asString(args, "source", { required: true })!;
        const body = asString(args, "body", { required: true, trim: false })!;
        if (!Array.isArray(args.mechanisms)) fail("mechanisms 必须是数组");
        const tags = Array.isArray(args.tags)
          ? args.tags.map((t) => String(t))
          : undefined;
        const humanFeel =
          args.human_feel && typeof args.human_feel === "object"
            ? (args.human_feel as Record<string, unknown>)
            : undefined;
        const bookCraft =
          args.book_craft && typeof args.book_craft === "object"
            ? (args.book_craft as Record<string, unknown>)
            : undefined;
        const handoff =
          args.handoff && typeof args.handoff === "object"
            ? (args.handoff as Record<string, unknown>)
            : undefined;
        const mind =
          args.mind && typeof args.mind === "object"
            ? (args.mind as Record<string, unknown>)
            : undefined;
        const paths = await openLibrary(exec, args);
        const { candId, warnings } = await LibraryPort.stageCard(paths, {
          title,
          sourceId,
          body,
          readingRange: asString(args, "reading_range"),
          axis: asString(args, "axis"),
          mechanisms: args.mechanisms as never,
          humanFeel,
          bookCraft,
          mind,
          handoff,
          kind: asString(args, "kind"),
          tags,
        });
        const lines = [
          `卡候选已暂存：${candId}`,
          `- 标题：${title}`,
          `- 来源：${sourceId}`,
          `- axis：${asString(args, "axis") || "（推断）"}`,
          `- 尚未入库；确认后 zhizhang_library_card_accept`,
        ];
        if (warnings.length) {
          lines.push("", "【软警告】");
          for (const w of warnings) lines.push(`- ${w}`);
        }
        return lines.join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_library_card_accept",
      description:
        "【闭环·库】显式采纳卡入库。未 accept 不得当已入库。下一步：library_combo_suggest → inspire_start 或 chapter_brief。",
      properties: {
        candidate: S("候选 id（lcand-…）"),
        working_dir: WORKING_DIR,
      },
      required: ["candidate"],
      async execute(args, exec) {
        const candId = asString(args, "candidate", { required: true })!;
        const paths = await openLibrary(exec, args);
        const { cardId, title } = await LibraryPort.acceptCard(paths, candId);
        return [
          `已采纳技法卡「${title}」→ cardId=${cardId}`,
          `- 状态：accepted`,
          `- 可检索：zhizhang_library_search / library_card_get`,
          "",
          "下一步（闭环）：zhizhang_library_combo_suggest → inspire_start(card_ids) 或 chapter_brief(card_ids)",
        ].join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_library_list",
      description:
        "【闭环·库】列出源与已采纳卡；可按书/轴过滤。常用下一步：combo_suggest 或 search。",
      properties: {
        what: S("sources | cards | all（默认 all）"),
        source: S("按单本 sourceId 过滤卡"),
        source_ids: {
          type: "array",
          description: "按多本 sourceId 过滤卡",
          items: { type: "string" },
        },
        source_title: S("按书名/作者子串过滤卡"),
        axis: S("craft | mind"),
        working_dir: WORKING_DIR,
      },
      required: [],
      async execute(args, exec) {
        const what = (asString(args, "what") ?? "all").toLowerCase();
        const paths = await openLibrary(exec, args);
        const sourceIds = Array.isArray(args.source_ids)
          ? args.source_ids.map((x) => String(x))
          : undefined;
        const axisRaw = asString(args, "axis");
        const axis: "craft" | "mind" | undefined =
          axisRaw === "craft" ? "craft" : axisRaw === "mind" ? "mind" : undefined;
        const filter = {
          status: "accepted" as const,
          sourceId: asString(args, "source"),
          sourceIds,
          sourceTitle: asString(args, "source_title"),
          axis,
        };
        const lines: string[] = ["# 拆书库"];
        if (what === "sources" || what === "all") {
          const sources = await LibraryPort.listSources(paths);
          lines.push("## 来源");
          if (sources.length === 0) lines.push("（空）");
          else {
            for (const s of sources) {
              lines.push(`- ${s.title}${s.author ? ` · ${s.author}` : ""}（${s.id}）`);
            }
          }
        }
        if (what === "cards" || what === "all") {
          const cards = await LibraryPort.listCards(paths, filter);
          lines.push("## 已采纳卡");
          if (cards.length === 0) lines.push("（空）");
          else {
            for (const c of cards) {
              lines.push(
                `- ${c.title}（${c.id}）· axis=${c.axis ?? "?"} · tags=${c.tags.join(",") || "—"} · src=${c.sourceId}`,
              );
            }
          }
        }
        if (paths.sourceRoot) {
          lines.push(`## 本地书源（${paths.sourceRoot}）`);
          const local = await listLocalBooks(paths.sourceRoot, { limit: 50 });
          if (local.length === 0) {
            lines.push("（目录里没有 .txt / .md 文件）");
          } else {
            const all = await LibraryPort.listSources(paths);
            const titles = new Set(all.map((x) => x.title));
            for (const b of local) {
              const kb = Math.max(1, Math.round(b.bytes / 1024));
              lines.push(`- ${b.name} · ${kb} KB · ${titles.has(b.title) ? "已导入" : "未导入"}`);
            }
            lines.push('导入：zhizhang_library_import { title, file: "<文件名>" }');
          }
        }
        return lines.join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_library_search",
      description:
        "【闭环·库】检索已采纳卡（可按书/轴）。下一步：combo_suggest 组包，或把 card_ids 交给 inspire/brief。",
      properties: {
        query: S("检索词（与过滤二选一或并用；仅过滤时可空）"),
        source: S("按单本 sourceId"),
        source_ids: {
          type: "array",
          description: "按多本 sourceId",
          items: { type: "string" },
        },
        source_title: S("按书名/作者子串"),
        axis: S("craft | mind"),
        working_dir: WORKING_DIR,
      },
      required: [],
      async execute(args, exec) {
        const query = asString(args, "query") ?? "";
        const paths = await openLibrary(exec, args);
        const sourceIds = Array.isArray(args.source_ids)
          ? args.source_ids.map((x) => String(x))
          : undefined;
        const axisRaw = asString(args, "axis");
        const axis: "craft" | "mind" | undefined =
          axisRaw === "craft" ? "craft" : axisRaw === "mind" ? "mind" : undefined;
        const hits = await LibraryPort.searchCards(paths, query, {
          sourceId: asString(args, "source"),
          sourceIds,
          sourceTitle: asString(args, "source_title"),
          axis,
        });
        const label = query || "(仅过滤)";
        if (hits.length === 0) return `无命中：「${label}」`;
        return [
          `检索「${label}」· ${hits.length} 条：`,
          ...hits.map(
            (c, i) =>
              `${i + 1}. ${c.title}（${c.id}）· axis=${c.axis ?? "?"} · src=${c.sourceId} · tags=${c.tags.join(",") || "—"}`,
          ),
        ].join("\n");
      },
    }),


    defineTool({
      name: "zhizhang_library_combo_suggest",
      description:
        "【闭环枢纽】推荐 1 mind + N craft（可跨书）card_ids。下一步：inspire_start(card_ids) 规划，或 chapter_brief(card_ids) 开写（lean 只吃 craft）。",
      properties: {
        source_ids: {
          type: "array",
          description: "限制候选池到来源（可多本；空=全库）",
          items: { type: "string" },
        },
        source_title: S("书名/作者子串限制候选池"),
        craft_count: {
          type: "integer",
          description: "技法张数 N（默认 2，1–8）",
        },
        query: S("主题检索，给 mind/craft 排序"),
        prefer_mind_source: S("优先从该 sourceId 抽 mind"),
        working_dir: WORKING_DIR,
      },
      required: [],
      async execute(args, exec) {
        const paths = await openLibrary(exec, args);
        const sourceIds = Array.isArray(args.source_ids)
          ? args.source_ids.map((x) => String(x))
          : undefined;
        const prefer = asString(args, "prefer_mind_source");
        const craftCount =
          typeof args.craft_count === "number" ? args.craft_count : undefined;
        const result = await LibraryPort.suggestCombo(paths, {
          sourceIds,
          sourceTitle: asString(args, "source_title"),
          craftCount,
          query: asString(args, "query"),
          preferMindSourceIds: prefer ? [prefer] : undefined,
        });
        if (!result.ok || !result.mind) {
          return [
            "组合建议失败：无可用 mind",
            `- 原因：${result.emptyReason ?? "未知"}`,
            "",
            "补救：拆书采纳 mind 卡，或放宽 source 过滤；仅技法试写用 inspire_start(craft_only=true)",
          ].join("\n");
        }
        const lines = [
          "组合包（1 mind + N craft）",
          `- card_ids：${result.cardIds.join(", ")}`,
          `- mind：${result.mind.title}（${result.mind.id}）· src=${result.mind.sourceId}`,
          `- craft ×${result.crafts.length}：`,
          ...result.crafts.map(
            (c, i) =>
              `  ${i + 1}. ${c.title}（${c.id}）· src=${c.sourceId}`,
          ),
          "",
          "用法：zhizhang_inspire_start(card_ids=[...]) 或 zhizhang_chapter_brief(card_ids=[...])",
          "说明：inspire/forge 吃全包（mind 主粮）；lean chapter_brief 只吃其中 craft。",
        ];
        if (result.warnings.length) {
          lines.push("", "【提示】");
          for (const w of result.warnings) lines.push(`- ${w}`);
        }
        return lines.join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_library_card_get",
      description: "【闭环·库】读已采纳卡全文（axis + craft/mind 证据）。确认后可 combo 或直接注入 brief。",
      properties: {
        card: S("cardId"),
        working_dir: WORKING_DIR,
      },
      required: ["card"],
      async execute(args, exec) {
        const cardId = asString(args, "card", { required: true })!;
        const paths = await openLibrary(exec, args);
        const card = await LibraryPort.getCard(paths, cardId);
        const axis = coerceAxis(card);
        const mech = card.mechanisms
          .map(
            (m, i) =>
              `${i + 1}. ${m.name}\n   体验：${m.experience}\n   重建：${m.rebuild}\n   可弃：${m.discard}\n   失败：${m.failWhen}`,
          )
          .join("\n");
        const lines = [
          `# ${card.title}（${card.id}）`,
          `- axis：${axis}`,
          `- sourceId：${card.sourceId}`,
          `- status：${card.status}`,
          `- kind（次标签）：${card.kind ?? "（未标）"}`,
          `- tags：${card.tags.join("、") || "（无）"}`,
          `- readingRange：${card.readingRange}`,
          "",
        ];
        if (axis === "mind") {
          lines.push("## 创作思维（mind）", formatMindBlock(card.mind), "");
        } else {
          lines.push(
            "## 活人证据（humanFeel · 写法+状态）",
            formatHumanFeelBlock(card.humanFeel),
            "",
            "## 续写面（bookCraft）",
            formatBookCraftBlock(card.bookCraft),
            "",
          );
        }
        lines.push("## handoff", formatHandoffBlock(card.handoff), "");
        lines.push("## 机制", mech || "（无）", "", "## 正文", card.body);
        return lines.join("\n");
      },
    }),
  ];
}
