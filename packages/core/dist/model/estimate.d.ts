export declare function estimateTokensRaw(text: string): number;
export declare function createEstimator(): {
    estimate(key: string, text: string): number;
    calibrate(key: string, estimated: number, actualInput: number): void;
};
//# sourceMappingURL=estimate.d.ts.map