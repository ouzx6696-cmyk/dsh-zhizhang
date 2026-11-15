export interface AtomicWriteOptions {
    onEinval?: (dir: string) => void;
}
export declare function atomicWrite(file: string, data: string | Uint8Array, opts?: AtomicWriteOptions): Promise<void>;
//# sourceMappingURL=atomic.d.ts.map