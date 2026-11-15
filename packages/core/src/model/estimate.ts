export function estimateTokensRaw(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    total += text.charCodeAt(i) > 127 ? 1 : 0.25;
  }
  return Math.ceil(total);
}

export function createEstimator() {
  const ratios = new Map<string, number>();

  return {
    estimate(key: string, text: string): number {
      const raw = estimateTokensRaw(text);
      const ratio = ratios.get(key) ?? 1;
      return Math.ceil(raw * ratio);
    },
    calibrate(key: string, estimated: number, actualInput: number) {
      if (estimated <= 0 || actualInput <= 0) return;
      const sample = actualInput / estimated;
      const prev = ratios.get(key) ?? 1;
      ratios.set(key, prev * 0.7 + sample * 0.3);
    },
  };
}
