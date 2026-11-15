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

export function calculateCost(usage: TokenUsage, price?: ModelPrice | null): number | null {
  if (!price) return null;
  const cached = Math.max(0, usage.cachedInput ?? 0);
  const uncachedInput =
    price.cachedInputPer1M !== undefined ? Math.max(0, usage.input - cached) : Math.max(0, usage.input);
  const inputCost = (uncachedInput / 1_000_000) * price.inputPer1M;
  const cachedCost =
    price.cachedInputPer1M !== undefined ? (cached / 1_000_000) * price.cachedInputPer1M : 0;
  const outputCost = (Math.max(0, usage.output) / 1_000_000) * price.outputPer1M;
  return inputCost + cachedCost + outputCost;
}

export function resolveModelPrice(
  model: string,
  table: PriceTable,
  override?: ModelPrice | null
): ModelPrice | undefined {
  if (override) return override;
  const exact = table[model];
  if (exact) return exact;
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.startsWith(key)) return table[key];
  }
  return undefined;
}

export function formatCost(cost: number | null, currency = "USD"): string {
  if (cost === null) return "unknown";
  const prefix = currency === "USD" ? "$" : currency === "CNY" ? "¥" : `${currency} `;
  return `${prefix}${cost.toFixed(4)}`;
}
