/** Writing pillar — assemble（按章序汇编完书）。 */
import { assembleManuscript } from "../store.js";
import { asString, boolArg, openWork } from "./context.js";
import { B, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
import type { ExecContext } from "./types.js";
export function exportTools() {
    return [
        defineTool({
            name: "fanqie_assemble",
            description: "【旁路·定稿交付】按章序汇编 markdown 成稿到 manuscripts/<书名>.md。完书口径：多数章 final 后跑（only_final=true 只收 reviewed/final）。章有改动重跑即覆盖。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                only_final: B("默认 false（收全部有正文章）"),
                output: S("可选相对路径，须位于 manuscripts 内，默认 manuscripts/<key>.md"),
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
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
