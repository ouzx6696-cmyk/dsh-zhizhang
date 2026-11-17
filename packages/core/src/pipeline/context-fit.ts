import { AppError } from "../errors/app-error.js";
import { estimateTokensRaw } from "../model/estimate.js";
import { renderContextPacket, type ContextPacket } from "./context-packet.js";

/** 在阶段方法、输入和输出格式已经确定后，按真实余量收缩可选块。 */
export function fitContext(
  packet: ContextPacket,
  budget: number,
  method: string,
  input: string,
  shape: string,
): ContextPacket {
  const reserve = estimateTokensRaw([method, input, shape].join("\n\n")) + (packet.reserve ?? 0);
  const available = Math.max(0, budget - reserve);
  const required = [...packet.prefix, ...packet.suffix].filter((block) => block.required);
  const requiredTokens = required.reduce((sum, block) => sum + estimateTokensRaw(block.text), 0);
  if (requiredTokens + reserve > budget)
    throw new AppError("model.context_overflow", "必带上下文超出阶段预算", {
      required: requiredTokens,
      reserve,
      budget,
    });
  const kept = new Set(required.map((block) => block.id));
  const omitted = [...packet.omitted];
  let remaining = available - requiredTokens;
  const fractions: Partial<Record<number, number>> = { 2: 0.25, 4: 0.15, 5: 0.1 };
  const used = new Map<number, number>();
  for (const block of [...packet.prefix, ...packet.suffix]
    .filter((block) => !block.required)
    .sort((a, b) => a.layer - b.layer)) {
    const tokens = estimateTokensRaw(block.text),
      cap = available * (fractions[block.layer] ?? 1);
    if (tokens > remaining || tokens + (used.get(block.layer) ?? 0) > cap) {
      omitted.push({ id: block.id, why: "stage-budget" });
      continue;
    }
    kept.add(block.id);
    remaining -= tokens;
    used.set(block.layer, (used.get(block.layer) ?? 0) + tokens);
  }
  const result = {
    ...packet,
    prefix: packet.prefix.filter((block) => kept.has(block.id)),
    suffix: packet.suffix.filter((block) => kept.has(block.id)),
    omitted,
    estimate: available - remaining,
  };
  const rendered = renderContextPacket(result);
  if (
    estimateTokensRaw([rendered.system, method, rendered.user, input, shape].join("\n\n")) > budget
  )
    throw new AppError("model.context_overflow", "阶段输入超出上下文预算", { budget });
  return result;
}
