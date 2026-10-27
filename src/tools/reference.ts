import { analyzeReference } from "../lib/services/reference.js";
import { storagePaths } from "../lib/work-store.js";
import { defineTool } from "./types.js";
import { asString, asStringArray, boolArg, config } from "./context.js";
import { S, B, WORKING_DIR } from "./schema.js";

export function referenceTools() {
    return [defineTool({
        name: "zhizhang_reference_analyze",
        description: "对指定片段准备轻量分析，或核对并保存已完成的分析与迁移包；默认不保存、不入公共库、不自动启动规划。本工具不调用模型。",
        properties: { text: S("指定原文"), question: S("本次要研究的问题"), report: S("可选：AI/作者实际完成的分析报告"),
            quotes: { type: "array", items: { type: "string" }, description: "需要核对的逐字短引文" },
            transfer_json: S("可选迁移包 JSON：experience、steps[]、recreate[]、discard[]、failWhen"), save: B("明确保存至工作区 analyses；不入公共库"), working_dir: WORKING_DIR },
        required: ["text", "question"],
        async execute(args: any, exec: any) {
            const text = asString(args, "text", { required: true, trim: false }), question = asString(args, "question", { required: true });
            const report = asString(args, "report", { trim: false });
            const transfer = asString(args, "transfer_json");
            const artifact = await analyzeReference(storagePaths(exec, config, asString(args, "working_dir")), {
                text, question, report, quotes: asStringArray(args, "quotes"), transfer: transfer ? JSON.parse(transfer) : undefined, save: boolArg(args, "save") === true,
            });
            return JSON.stringify({ ...artifact, ...(!report ? { brief: "只分析所给范围：还原关键过程，区分事实与解释，提炼少量可迁移做法、必须重造部分和失效边界。不要凑字段、外推全书或自动入库。", sourceText: text } : {}) }, null, 2);
        },
    })];
}
