import { describe, expect, test } from "bun:test";
import { dialogueRanges, lintStyle, summarizeStyleLint } from "../../src/lib/style-linter.ts";

describe("style-linter sensor", () => {
  test("dialogue exempt; four diagnostic classes; slogan last-para only", () => {
    const text =
      "沈砚不禁停住。他说：“不是愤怒，而是计算。”又补了一句：「眼中闪过一丝犹豫。」旁白却写：不是愤怒，而是计算。";
    const ranges = dialogueRanges(text);
    expect(ranges.length).toBe(2);
    const hits = lintStyle(text);
    expect(hits.some((hit) => hit.match.includes("不是愤怒，而是") && hit.start > text.indexOf("旁白"))).toBe(
      true,
    );
    for (const hit of hits) {
      for (const [start, end] of ranges) {
        expect(hit.start < start || hit.start >= end).toBe(true);
      }
    }
    expect(hits.some((hit) => hit.match.includes("眼中闪过一丝"))).toBe(false);

    const ai = [
      "他不是害怕，而是在衡量代价。嘴角勾起一抹冷笑，眼中闪过一丝杀意。",
      "他感到一阵莫名的绝望，心中涌起一股愤怒。",
      "经过一番激烈的心理斗争，很快便处理妥当。",
      "灯灭了。",
      "他知道，属于他的传奇才刚刚开始。",
    ].join("\n");
    const summary = summarizeStyleLint(lintStyle(ai));
    expect(summary.cliche_syntax).toBeGreaterThan(0);
    expect(summary.lazy_emotion).toBeGreaterThan(0);
    expect(summary.process_skip).toBeGreaterThan(0);
    expect(summary.slogan_ending).toBeGreaterThan(0);

    const sloganMid =
      "他知道，属于他的传奇才刚刚开始。\n\n灯里没有名字，沈砚把镊子弹回匣中。";
    expect(lintStyle(sloganMid).some((h) => h.category === "slogan_ending")).toBe(false);
    expect(lintStyle("")).toEqual([]);
  });
});
