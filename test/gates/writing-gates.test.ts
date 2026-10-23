import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import {
  BriefGate,
  LintGate,
  PayoffGate,
  SaveBypassGate,
} from "../../src/lib/ports/index.ts";

describe("Writing hard/soft gates", () => {
  test("LintGate soft vs strict", () => {
    const soft = LintGate.evaluateAccept({ hitCount: 2, strictLint: false });
    expect(soft.ok).toBe(true);
    expect(soft.messages.some((m) => m.code === "lint_hits_present")).toBe(true);
    const hard = LintGate.evaluateAccept({ hitCount: 2, strictLint: true });
    expect(hard.ok).toBe(false);
    expect(hard.messages[0]?.code).toBe("lint_hits_strict");
  });

  test("BriefGate required / skip / ok", () => {
    expect(BriefGate.evaluateAccept({ brief: null, skipBrief: false }).messages[0]?.code).toBe(
      "brief_required",
    );
    expect(BriefGate.evaluateAccept({ brief: null, skipBrief: true }).ok).toBe(true);
    expect(
      BriefGate.evaluateAccept({
        brief: { chapterId: "c001", at: "2026-01-01T00:00:00.000Z", assetIds: ["draft"] },
        skipBrief: false,
      }).ok,
    ).toBe(true);
  });

  test("PayoffGate soft missing / hard require", () => {
    const soft = PayoffGate.evaluateAccept({ payoff: null, requirePayoff: false });
    expect(soft.ok).toBe(true);
    expect(soft.messages[0]?.code).toBe("payoff_missing");
    const hard = PayoffGate.evaluateAccept({ payoff: null, requirePayoff: true });
    expect(hard.ok).toBe(false);
  });

  test("SaveBypassGate large body needs confirm", () => {
    const deny = SaveBypassGate.evaluate({
      contentProvided: true,
      wordCount: 500,
      confirmBypass: false,
    });
    expect(deny.ok).toBe(false);
    expect(deny.messages[0]?.code).toBe("bypass_confirm_required");
    expect(
      SaveBypassGate.evaluate({
        contentProvided: true,
        wordCount: 500,
        confirmBypass: true,
      }).ok,
    ).toBe(true);
  });
});
