import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import { AcceptPolicy } from "../../src/lib/ports/index.ts";
import type { CandidateFile } from "../../src/lib/types.ts";

describe("AcceptPolicy composition", () => {
  test("brief_required hard-denies; skipBrief allows with soft echoes", () => {
    const cand = { lintHitCount: 1, body: "短。" } as CandidateFile;
    const denied = AcceptPolicy.evaluate({
      candidate: cand,
      brief: null,
      payoff: null,
      skipBrief: false,
    });
    expect(denied.ok).toBe(false);
    expect(denied.messages.some((m) => m.code === "brief_required")).toBe(true);

    const allowed = AcceptPolicy.evaluate({
      candidate: cand,
      brief: null,
      payoff: null,
      skipBrief: true,
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.receiptLines.some((l) => l.includes("lintHitCount：1"))).toBe(true);
    expect(allowed.receiptLines.some((l) => l.includes("lint_hits_present"))).toBe(true);
    expect(allowed.receiptLines.some((l) => l.includes("brief_skipped"))).toBe(true);
    expect(allowed.receiptLines.some((l) => l.includes("payoff_missing"))).toBe(true);
  });
});
