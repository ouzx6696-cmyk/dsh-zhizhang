import type { Parser } from "../schema/parse.js";
export declare function readTextIfExists(file: string): Promise<string | undefined>;
export declare function readJson<T>(file: string, parser: Parser<T>): Promise<T | undefined>;
//# sourceMappingURL=read.d.ts.map