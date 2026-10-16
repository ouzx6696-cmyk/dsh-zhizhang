import { describe, expect, test } from "bun:test";
import {
  AcceptPolicy,
  NovelSenseAuditorPort,
  NovelSenseGate,
  auditNovelSense,
} from "../../src/lib/ports/index.ts";
import type { CandidateFile } from "../../src/lib/types.ts";
import { padBody } from "../helpers.ts";

const CH01 = padBody(`
三点十七分，林晚掀开第三层冷柜的门。霜结得不对，靠外侧那半边厚。门内映出货架，价签写着空城一夜。
她伸出手，握住同样的弧度，抽出来一瓶等重的柠檬茶。复核货架时少了一罐同价位气泡水，差额第一次出现。
扫码枪滴一声。账还摊在台面上，对不上。下次陈默若来实点，她不知道怎么办。
`);

const REDEMO = padBody(`
两点四十五分，陈默进来了。林晚又开始盘点。第三层霜结起来，门内再次映出空城一夜的货架。
她按等重规则伸手进去，抽回来同一瓶，放回货架。复核时又少了一罐，缺口还在。
扫码枪一路滴过去。她把零钱补上差额，心里想着对轨真灵。
一切恢复如常，就像什么都没发生，她终于安心睡了个好觉。
`);

const ADJACENT = padBody(`
陈默站在门口解围巾，没先看冷柜，先看账本。林晚把零钱盒推过去，手指停在抽屉沿上半晌。
「四个周三，各短三块。」他翻页，并不问霜和门内。她想解释对轨，话到嘴边又咽了。
钥匙从他手心滑到她掌心：「下不为例。明天监控我要调。」
门外的风灌进来。她攥着钥匙，不知明天怎么办，账页还摊着。
`, 3);

const CLOSED = padBody(`
那天夜里她终于弄清了冷柜的规矩，换回想要的那瓶饮料，补齐了账上的数字。
店里恢复了往常的灯光与冷气声。她关好门，洗了把脸。
就像什么都没发生过，一切恢复如常。岁月静好，她睡了个好觉，故事到此圆满。
`);

const OPEN = padBody(`
她把半瓶乌龙推回第三层，门没关严。何姐的语音还停在「明天早班别迟到」。
条子压在抽屉夹层，钥匙是新的。监控红点在角落里闪。
林晚靠着冷柜外沿，想说下次不碰了，又听见门外脚步——不知是不是陈默。
账还对不上。她先这样站着，等风过去再说。
`, 3);

describe("NovelSenseGate suite", () => {
  test("same-skeleton / adjacent / closed / open behaviors", () => {
    expect(
      auditNovelSense(REDEMO, { prevBody: CH01 }).hits.some((h) => h.code === "same_skeleton_redemo"),
    ).toBe(true);
    expect(
      auditNovelSense(ADJACENT, { prevBody: CH01 }).hits.some((h) => h.code === "same_skeleton_redemo"),
    ).toBe(false);
    expect(auditNovelSense(CLOSED).hits.some((h) => h.code === "closed_short_story")).toBe(true);
    expect(auditNovelSense(OPEN, { prevBody: CH01 }).hitCount).toBe(0);
    expect(
      auditNovelSense(REDEMO).hits.some((h) => h.code === "same_skeleton_redemo"),
    ).toBe(false);
  });

  test("soft warn vs strict deny; AcceptPolicy composes", () => {
    const soft = NovelSenseGate.evaluateAccept({
      body: REDEMO,
      prevBody: CH01,
      strictNovel: false,
    });
    expect(soft.ok).toBe(true);
    expect(soft.messages.some((m) => m.code === "novel_sense_hits")).toBe(true);

    const hard = NovelSenseGate.evaluateAccept({
      body: REDEMO,
      prevBody: CH01,
      strictNovel: true,
    });
    expect(hard.ok).toBe(false);
    expect(hard.messages[0]?.code).toBe("novel_sense_strict");

    const cand = { lintHitCount: 0, body: REDEMO } as CandidateFile;
    const allowed = AcceptPolicy.evaluate({
      candidate: cand,
      brief: null,
      payoff: null,
      skipBrief: true,
      prevBody: CH01,
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.receiptLines.some((l) => l.includes("novel_sense_hits"))).toBe(true);

    const text = NovelSenseAuditorPort.format("fixture", NovelSenseAuditorPort.audit(CLOSED));
    expect(text).toContain("书感软雷达");
  });
});
