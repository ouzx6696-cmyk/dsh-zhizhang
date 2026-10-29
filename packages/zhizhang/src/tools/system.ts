/** System / product map / panel — orient to the single creative loop. */
import { buildPanelSnapshot } from "../lib/store.js";
import { ProductMap } from "../lib/ports/index.js";
import { SYSTEM_BRIEF } from "./brief.js";
import { asString, openWork } from "./context.js";
import { E, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
import type { ExecContext } from "./types.js";
export function systemTools() {
    return [
        defineTool({
            name: "zhizhang_system_brief",
            description: "硬规则钉死（默认路径 + 旁路指针）。开写前或上下文压缩后调用。调度全图：zhizhang_product_map。",
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
            description: "【调度主入口】默认路径 vs 旁路 + 闭环三阶段 + 分喂 + 质量面。开局/迷路先看。不写库、不调模型。",
            properties: {},
            required: [],
            async execute() {
                return ProductMap.formatForAgent();
            },
        }),
        defineTool({
            name: "zhizhang_panel_snapshot",
            description: "导出当前作品的轻量面板快照：章节进度、处境摘要、待采纳候选、审校留痕最近条、下一步提示。format=json|html|both（默认 json，紧凑无缩进——这是给模型看的；HTML 仅在明确要嵌入网页时才传 html/both）。不写库、不调模型。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                format: E(["json", "html", "both"], "默认 json"),
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const { paths, dir } = await openWork(exec, args);
                const snap = await buildPanelSnapshot(dir, paths);
                const fmt = asString(args, "format") ?? "json";
                if (fmt === "html")
                    return snap.html;
                // 紧凑序列化：pretty-print 只会双倍 token，对模型没有可读性收益。
                const { html: _h, ...rest } = snap;
                if (fmt === "json")
                    return JSON.stringify(rest);
                return [`## 面板 JSON`, "```json", JSON.stringify(rest), "```", "", "## 面板 HTML", snap.html].join("\n");
            },
        }),
    ];
}
