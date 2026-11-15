export interface ModelPrice {
    inputPer1M: number;
    outputPer1M: number;
    cachedInputPer1M?: number;
    currency?: string;
}
export interface TokenUsage {
    input: number;
    cachedInput?: number;
    output: number;
}
export type PriceTable = Record<string, ModelPrice>;
export declare function calculateCost(usage: TokenUsage, price?: ModelPrice | null): number | null;
export declare function resolveModelPrice(model: string, table: PriceTable, override?: ModelPrice | null): ModelPrice | undefined;
export declare function formatCost(cost: number | null, currency?: string): string;
//# sourceMappingURL=price.d.ts.map