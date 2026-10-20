/** Writing pillar — assemble / export. */
import { assembleManuscript } from "../lib/store.js";
import { asString, openWork } from "./context.js";
import { B, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
export function exportTools() {
    return [
        defineTool({
            name: "zhizhang_assemble",
            description: "按章序汇编 markdown 成稿到 manuscripts/。only_final 时只收 reviewed/final。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                only_final: B("默认 false"),
                output: S("可选相对路径，默认 manuscripts/<key>.md"),
            },
            required: [],
            async execute(args, exec) {
                const { paths, dir } = await openWork(exec, args);
                const result = await assembleManuscript(dir, paths, {
                    onlyFinal: Boolean(args.only_final),
                    outputRel: asString(args, "output"),
                });
                return `成稿：${result.file}\n- 收录 ${result.chapters} 章，约 ${result.words} 字`;
            },
        }),
        defineTool({
            name: "zhizhang_export",
            description: "导出别名：同 zhizhang_assemble（保留语义兼容）。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                only_final: B("默认 false"),
                output: S("可选相对路径"),
            },
            required: [],
            async execute(args, exec) {
                const { paths, dir } = await openWork(exec, args);
                const result = await assembleManuscript(dir, paths, {
                    onlyFinal: Boolean(args.only_final),
                    outputRel: asString(args, "output"),
                });
                return `导出：${result.file}\n- ${result.chapters} 章 · ${result.words} 字`;
            },
        }),
    ];
}
