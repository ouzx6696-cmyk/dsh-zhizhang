export declare function withLock(key: string, fn: (...args: any[]) => any): Promise<any>;
export declare function countWords(text: string): number;
export declare function assertResourceId(id: string, label?: string): string;
export declare function atomicWrite(file: string, content: string): Promise<void>;
export declare function nowIso(): string;
/** Only "file is absent" is a valid reason to create a fresh chapter record. */
export declare function isMissingFileError(err: any): boolean;
