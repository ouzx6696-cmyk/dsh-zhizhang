import type { WorkbenchCommand, WorkbenchCommandMap } from "@zhizhang/workbench/contract";
export type ToutiaoWorkbenchCommand = Extract<WorkbenchCommand, "toutiao.articles" | "toutiao.article.create" | "toutiao.article.transition" | "toutiao.article.deliver">;
export declare function isToutiaoCommand(operation: string): operation is ToutiaoWorkbenchCommand;
export declare function runToutiaoCommand<K extends ToutiaoWorkbenchCommand>(operation: K, input: WorkbenchCommandMap[K]["input"]): Promise<{
    ok: true;
    data: WorkbenchCommandMap[K]["result"];
} | {
    ok: false;
    code: string;
    error: string;
}>;
//# sourceMappingURL=api.d.ts.map