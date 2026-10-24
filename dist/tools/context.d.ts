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
/**
 * 严格旗标透传：true/false 原样返回，未传保持 undefined。
 * AcceptPolicy 用 `?? PortConfig 默认值` 兜底——若调用方先用 Boolean() 把
 * undefined 抹成 false，配置默认值（defaultStrictLint 等）就永远不会生效。
 */
export declare function boolArg(args: any, key: string): boolean | undefined;
export declare function openWork(exec: ExecContext, args: any): Promise<{
    paths: import("../lib/types.js").StoragePaths;
    dir: string;
    key: any;
}>;
