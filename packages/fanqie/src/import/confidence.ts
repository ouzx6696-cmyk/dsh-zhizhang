export interface ConfidenceParts {
  self: number;
  loc: number;
  kindFit: number;
  crossChunk: number;
  noConflict: number;
}
export const CONFIDENCE_WEIGHTS: ConfidenceParts = {
  self: 0.35,
  loc: 0.35,
  kindFit: 0.05,
  crossChunk: 0.1,
  noConflict: 0.15,
};
export function confidence(parts: ConfidenceParts, weights: ConfidenceParts = CONFIDENCE_WEIGHTS) {
  const score = Math.max(
    0,
    Math.min(
      1,
      parts.self * weights.self +
        parts.loc * weights.loc +
        parts.kindFit * weights.kindFit +
        parts.crossChunk * weights.crossChunk +
        parts.noConflict * weights.noConflict,
    ),
  );
  const band: "high" | "mid" | "low" = score >= 0.8 ? "high" : score >= 0.55 ? "mid" : "low";
  return { score, band, parts: { ...parts } };
}
/** 离线标注校准：满足高档精确率后最大化召回；没有足够标注时不改默认权重。 */
export function calibrateConfidence(samples: Array<{ parts: ConfidenceParts; correct: boolean }>) {
  let best = { weights: CONFIDENCE_WEIGHTS, precision: 0, recall: 0, accepted: 0 };
  const distance = (weights: ConfidenceParts) =>
    Object.entries(weights).reduce(
      (sum, [key, value]) => sum + Math.abs(value - (Reflect.get(CONFIDENCE_WEIGHTS, key) ?? 0)),
      0,
    );
  const positive = samples.filter((sample) => sample.correct).length;
  for (let a = 0; a <= 20; a++)
    for (let b = 0; b <= 20 - a; b++)
      for (let c = 0; c <= 20 - a - b; c++)
        for (let d = 0; d <= 20 - a - b - c; d++) {
          const weights = {
            self: a / 20,
            loc: b / 20,
            kindFit: c / 20,
            crossChunk: d / 20,
            noConflict: (20 - a - b - c - d) / 20,
          };
          const accepted = samples.filter(
            (sample) => confidence(sample.parts, weights).band === "high",
          );
          const correct = accepted.filter((sample) => sample.correct).length;
          const precision = accepted.length ? correct / accepted.length : 0,
            recall = positive ? correct / positive : 0;
          if (
            precision >= 0.95 &&
            (recall > best.recall ||
              (recall === best.recall &&
                (precision > best.precision ||
                  (precision === best.precision && distance(weights) < distance(best.weights)))))
          )
            best = { weights, precision, recall, accepted: accepted.length };
        }
  return best;
}
