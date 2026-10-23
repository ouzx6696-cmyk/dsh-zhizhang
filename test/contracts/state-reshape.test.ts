import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import {
  admitCardContent,
  neutralizeVoiceNegations,
  FoundationPort,
  resolveHappenedText,
  ProductMap,
  QualityPolicy,
} from "../../src/lib/ports/index.ts";
import { formatReaderContract, getMethodAsset } from "../../src/lib/method-assets.ts";
import { SYSTEM_BRIEF } from "../../src/tools/brief.ts";
import { REVIEW_EVIDENCE_KINDS } from "../../src/lib/types.ts";

describe("state reshape 0.10.x", () => {
  test("agent-visible copy: 当前小说状态, not 书账/book_ledger", () => {
    expect(SYSTEM_BRIEF).toContain("当前小说状态");
    expect(SYSTEM_BRIEF).not.toContain("书账");
    expect(SYSTEM_BRIEF).not.toMatch(/不是账本流水/);
    const map = ProductMap.formatForAgent();
    expect(map).toContain("当前小说状态");
    expect(map).not.toContain("书账");
    const receipt = FoundationPort.acceptReceiptLines({
      chapterId: "c001",
      ending: "她没关门",
      threads: "条子",
      append: {
        meta: {} as never,
        appended: true,
        line: "[c001] 她没关门",
      },
      happenedSource: "body_tail",
    });
    const joined = receipt.join("\n");
    expect(joined).toContain("novel_state");
    expect(joined).not.toContain("book_ledger");
    expect(REVIEW_EVIDENCE_KINDS[0]).toContain("锁定/伏笔");
    expect(REVIEW_EVIDENCE_KINDS[0]).not.toContain("旧账");
  });

  test("items not elevated: lean contract softens 留物 KPI", () => {
    const lean = formatReaderContract({
      premise: "p",
      planned: "pl",
      threads: "t",
      lean: true,
      previous: {
        id: "c001",
        title: "一",
        ending: "叫住他说手套。",
        body: "雨里他转身。鞋里全是水。先找个能坐的地方。",
      },
    });
    expect(lean).toContain("书感三弹");
    expect(lean).toContain("未了局面");
    expect(lean).toContain("换压力");
    expect(lean).not.toMatch(/勿点名交差/);
    expect(lean).not.toMatch(/章末留可碰的物/);
    expect(QualityPolicy.poisonPolicy).toContain("嵌进动作与当场压力");
    expect(QualityPolicy.poisonPolicy).not.toMatch(/勿点名交差/);
    expect(QualityPolicy.poisonPolicy).not.toMatch(/获得物\/代价\/账/);
  });

  test("lean injects previous chapter body (not just ending/tail) when ending present", () => {
    const fullBody =
      "桥上表慢半拍。" +
      "中段对质，值班册后补墨。" +
      "「你看见了什么？」沈砚说先找个能坐的地方，鞋里全是水。";
    const lean = formatReaderContract({
      premise: "p",
      planned: "pl",
      threads: "t",
      lean: true,
      continuation: true,
      previous: {
        id: "c001",
        title: "一",
        ending: "叫住转身要走的人，只说「手套。」",
        body: fullBody,
      },
    });
    expect(lean).toContain("前章正文");
    expect(lean).toContain("桥上表慢半拍");
    expect(lean).toContain("鞋里全是水");
    expect(lean).not.toContain("前章文末摘录");
    expect(lean).toMatch(/纲末与正文可能不一致|前章正文/);
  });

  test("resolveHappenedText prefers body_tail on ending drift", () => {
    const aligned = resolveHappenedText({
      ending: "条子压在账本下",
      body: "她把条子压进账本，没再关门。",
    });
    expect(aligned.source).toBe("ending");
    expect(aligned.text).toContain("条子");

    const drift = resolveHappenedText({
      ending: "叫住转身要走的人，只说「手套。」",
      body:
        "对方反问你看见了什么。沈砚说先找个能坐的地方。鞋里全是水。雨还在下。",
    });
    expect(drift.source).toBe("body_tail");
    expect(drift.text).toMatch(/鞋里全是水|能坐的地方/);
    expect(drift.warn).toBeTruthy();
  });

  test("voice admit: 非声纹 disclaimer does not hard-reject; positive still rejects with snippet", () => {
    expect(neutralizeVoiceNegations("状态如何落纸（非声纹）")).not.toContain("声纹");

    const ok = admitCardContent({
      title: "高压半截话",
      body: "写法：半截话抢节奏。状态如何落纸（非声纹）。characterState 写怂。",
      axis: "craft",
      mechanisms: [
        { name: "半截话", experience: "e", rebuild: "r", discard: "d", failWhen: "f" },
      ],
    });
    expect(ok.hardReject).toBeUndefined();

    const bad = admitCardContent({
      title: "角色声纹范本",
      body: "以下是角色专属声音与台词范本，请背诵对白。",
      axis: "craft",
      mechanisms: [
        { name: "声线", experience: "e", rebuild: "r", discard: "d", failWhen: "f" },
      ],
    });
    expect(bad.hardReject).toBeTruthy();
    expect(bad.hardReject!).toContain("命中");
    expect(bad.hardReject!).toContain("改法");
  });

  test("0.10.3: cadence cue + opening craft; lean omits duplicate chapterEnding", () => {
    const style = getMethodAsset("style_contract");
    expect(style?.body).toContain("句长有起伏");
    expect(style?.body).toMatch(/长短句/);

    const opening = formatReaderContract({
      premise: "夜班便利店",
      planned: "先立合同",
      threads: "",
      lean: true,
      chapterEnding: "她没关门",
    });
    expect(opening).toContain("开篇写法");
    expect(opening).toContain("小而真");
    expect(opening).not.toContain("本章 ending 承诺");

    const full = formatReaderContract({
      premise: "p",
      planned: "pl",
      threads: "t",
      lean: false,
      chapterEnding: "她没关门",
    });
    expect(full).toContain("本章 ending 承诺");
    expect(full).toContain("开篇写法");
  });

});
