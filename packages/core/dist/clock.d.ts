export interface Clock {
    now(): number;
    iso(): string;
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export declare const systemClock: Clock;
//# sourceMappingURL=clock.d.ts.map