/** Cached polling read; callers needing integrity must read and hash the file directly. */
export declare function readTextCached(file: string): Promise<string>;
/** readTextCached + JSON.parse；解析失败照常抛错（坏文件不缓存）。 */
export declare function readJsonCached<T = any>(file: string): Promise<T>;
/** JSONL: an absent file is empty; malformed or inaccessible files remain visible errors. */
export declare function readJsonlCached(file: string): Promise<any[]>;
