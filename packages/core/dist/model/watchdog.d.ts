export declare const DEFAULT_FIRST_EVENT_MS: number;
export declare const DEFAULT_IDLE_MS: number;
export declare function createWatchdog(parentSignal: AbortSignal, firstEventMs?: number, idleMs?: number): {
    signal: AbortSignal;
    poke(): void;
    hasSeenFirst: () => boolean;
    dispose(): void;
};
//# sourceMappingURL=watchdog.d.ts.map