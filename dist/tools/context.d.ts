import type { ExecContext } from "../lib/types.js";
export declare let config: {};
export declare function setPluginConfig(next: any): void;
export declare function sessionKey(exec: ExecContext): any;
export declare function rememberWork(exec: ExecContext, key: string): void;
export declare function fail(message: string, code?: any): void;
export declare function asString(args: any, key: string, opts?: any): any;
/**
 * 字符串数组参数（如 card_ids / source_ids / tags）。
 *
 * 与 asString 保持同一口径：类型不对就硬拒，绝不静默降级成空数组——
 * 静默降级会让调用方拿到"没卡/没结果"的正常回执，排查成本极高。
 */
export declare function asArray(args: any, key: string, opts?: any): any;
export declare function asStringArray(args: any, key: string, opts?: any): any;
export declare function openWork(exec: ExecContext, args: any): Promise<{
    paths: import("../lib/types.js").StoragePaths;
    dir: string;
    key: any;
}>;
