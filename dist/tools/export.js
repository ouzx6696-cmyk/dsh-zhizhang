/** Writing pillar — assemble（完书交付动作；export 别名已并入本工具）。 */
import { assembleManuscript } from "../lib/store.js";
import { asString, boolArg, openWork } from "./context.js";
import { B, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
export function exportTools() {
    return [
        defineTool({
            name: "zhizhang_assemble",
            description: "【旁路·定稿交付】按章序汇编 markdown 成稿到 manuscripts/<书名>.md。完书口径：多数章 final 后跑（only_final=true 只收 reviewed/final）。章有改动重跑即覆盖。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                only_final: B("默认 false（收全部有正文章）"),
                output: S("可选相对路径，默认 manuscripts/<key>.md"),
            },
            required: [],
            async execute(args, exec) {
                const { paths, dir } = await openWork(exec, args);
                const result = await assembleManuscript(dir, paths, {
                    onlyFinal: boolArg(args, "only_final") ?? false,
                    outputRel: asString(args, "output"),
                });
                return `成稿：${result.file}\n- 收录 ${result.chapters} 章，约 ${result.words} 字`;
            },
        }),
    ];
}
