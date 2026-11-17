import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { text } from "../support/v14.mjs";
test("约一百万字、多段正文 → 分节分块在 300 ms 内完成且偏移覆盖", () => {
  const paragraph = "林川沿着旧码头寻找信上的名字，沈遥在灯下核对潮汐留下的记号。".repeat(4),
    source = "# 开篇\n" + Array.from({ length: 9000 }, (_, i) => `${i} ${paragraph}`).join("\n\n"),
    start = performance.now();
  const result = text.segment(source, { format: "md" }),
    chunks = text.chunk(result, { maxTokens: 8000, estimate: (s) => s.length });
  const elapsed = performance.now() - start;
  assert.ok(source.length >= 1000000);
  assert.equal(
    chunks.flatMap((chunk) => chunk.paras).length,
    result.segments.flatMap((section) => section.paras).length,
  );
  assert.ok(chunks.every((chunk) => chunk.tokens <= 8000));
  assert.ok(elapsed < 300, `${source.length} 字符耗时 ${elapsed.toFixed(1)} ms`);
  console.info(
    "TEXT_PERFORMANCE",
    JSON.stringify({
      characters: source.length,
      paras: chunks.flatMap((c) => c.paras).length,
      chunks: chunks.length,
      elapsedMs: Math.round(elapsed * 10) / 10,
    }),
  );
});
