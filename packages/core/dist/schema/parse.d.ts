export type Parser<T> = (v: unknown, path?: string) => T;
export type Infer<P> = P extends Parser<infer T> ? T : never;
export declare function str(opts?: {
    min?: number;
    max?: number;
    trim?: boolean;
}): Parser<string>;
export declare function int(opts?: {
    min?: number;
    max?: number;
}): Parser<number>;
export declare function num(opts?: {
    min?: number;
    max?: number;
}): Parser<number>;
export declare const bool: Parser<boolean>;
export declare function lit<const L extends readonly string[]>(...values: L): Parser<L[number]>;
export declare function arr<T>(item: Parser<T>, opts?: {
    max?: number;
}): Parser<T[]>;
export declare function obj<S extends Record<string, Parser<unknown>>>(shape: S, opts?: {
    strict?: boolean;
}): Parser<{
    [K in keyof S]: ReturnType<S[K]>;
}>;
export declare function opt<T>(parser: Parser<T>): Parser<T | undefined>;
export declare function record<T>(valParser: Parser<T>): Parser<Record<string, T>>;
//# sourceMappingURL=parse.d.ts.map