/** System / product map / panel — orient to the single creative loop. */
import { buildPanelSnapshot } from "../lib/store.js";
import { ProductMap } from "../lib/ports/index.js";
import { SYSTEM_BRIEF } from "./brief.js";
import { asString, openWork } from "./context.js";
import { E, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool, type ToolDef } from "./types.js";

export function systemTools(): ToolDef[] {
  return [
    defineTool({
      name: "zhizhang_system_brief",
      description:
        "硬规则钉死（默认路径 + 旁路指针）。开写前或上下文压缩后调用。调度全图：zhizhang_product_map。",
      properties: { working_dir: WORKING_DIR },
      required: [],
      async execute() {
        return [
          SYSTEM_BRIEF,
          "",
          `默认：${ProductMap.loopLine()}`,
          "全图（含旁路）：zhizhang_product_map。面板：zhizhang_panel_snapshot。",
        ].join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_product_map",
      description:
        "【调度主入口】默认路径 vs 旁路 + 闭环三阶段 + 分喂 + 质量面。开局/迷路先看。不写库、不调模型。",
      properties: {},
      required: [],
      async execute() {
        return ProductMap.formatForAgent();
      },
    }),

    defineTool({
      name: "zhizhang_panel_snapshot",
      description:
        "导出当前作品的轻量面板快照：章节进度、处境摘要、待采纳候选、审校留痕最近条、下一步提示；同时给出可嵌入的 HTML。format=json|html|both（默认 both）。不写库、不调模型。",
      properties: {
        work: WORK_OPT,
        working_dir: WORKING_DIR,
        format: E(["json", "html", "both"], "默认 both"),
      },
      required: [],
      async execute(args, exec) {
        const { dir } = await openWork(exec, args);
        const snap = await buildPanelSnapshot(dir);
        const fmt = (asString(args, "format") as "json" | "html" | "both" | undefined) ?? "both";
        if (fmt === "html") return snap.html;
        if (fmt === "json") {
          const { html: _h, ...rest } = snap;
          return JSON.stringify(rest, null, 2);
        }
        const { html, ...rest } = snap;
        return [`## 面板 JSON`, "```json", JSON.stringify(rest, null, 2), "```", "", "## 面板 HTML", html].join(
          "\n",
        );
      },
    }),
  ];
}
