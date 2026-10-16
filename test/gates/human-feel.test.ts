import { describe, expect, test } from "bun:test";
import {
  AcceptPolicy,
  HumanFeelAuditorPort,
  HumanFeelGate,
  auditHumanFeel,
} from "../../src/lib/ports/index.ts";
import type { CandidateFile } from "../../src/lib/types.ts";
import { padBody } from "../helpers.ts";

const TIDY = padBody(`
她打开冷柜。她看见霜。她伸手进去。她摸到空罐。她数了货架。她记下缺口。她算了差价。她拿出零钱。
「请把账本拿过来。」「核对货架实点。」「补上差价。」「下次按货架实点。」「现在登记缺口。」「确认金额。」
柜里是柠檬茶的罐、气泡水的瓶、能量饮的纸盒、酸奶的盒、冰棒的袋、速食面的箱、还有一排标签整齐的价签与空托盘与备用灯管。
`);

const ROUGH = padBody(`
她本想对完轨就走人，手指却在第三层停住——霜比昨天厚，厚得不像店里该有的那种。
「你……」话到嘴边又咽了回去。算了，他不一定听得懂。
陈默站在门口，像在等她先开口。她搓了搓冻僵的指节，嗓子发紧，差点把零钱盒打翻。
货架上少的那一罐柠檬茶，她记得味道，却忽然忘了该怎么跟他说。半晌，她只干笑一声：「今晚……先这样吧。」
`, 3);

const ENUM_DUMP = padBody(`
夜班结束后，林晚清点收获。她获得了霜纹图谱、对轨口诀、等重换货规则、临期券三张、空半格记号笔。
店里灯还亮着，她把纸条塞进抽屉，准备交班。
`, 3);

const LEDGER = padBody(`
她把账本摊开核对金额。第一行差价三元，第二行实点少两块，第三行结余十五元，第四行入账八元。
收据与发票叠在价签旁，盘点表写着差额与金额，对账栏再记一次结余。
`, 3);

const DOMESTIC = padBody(`
她回家先洗碗。然后拖地。接着叠衣服。电饭煲响了她去热饭。
她又泡了茶。垃圾袋满了她去倒垃圾。围裙还挂在晾衣架边上。
抹布和菜板摆回原位。洗洁精快没了。拖鞋踢到门边。
`, 2);

describe("HumanFeelGate suite", () => {
  test("tidy template prose hits; rough living prose stays clean", () => {
    const tidy = auditHumanFeel(TIDY);
    expect(tidy.hitCount).toBeGreaterThan(0);
    expect(
      tidy.hits.some((h) =>
        ["uniform_short_run", "task_dialogue_wall", "object_list_cold"].includes(h.code),
      ),
    ).toBe(true);
    expect(auditHumanFeel(ROUGH).hitCount).toBe(0);
    const over = tidy.hits.find((h) => h.code === "uniform_short_run");
    if (over) expect(over.text).toContain("让节奏有起伏");
  });

  test("poison soft sensors: setting_enum / ledger / domestic", () => {
    const enumHits = auditHumanFeel(ENUM_DUMP);
    expect(enumHits.hits.some((h) => h.code === "setting_enum_dump")).toBe(true);

    const ledgerHits = auditHumanFeel(LEDGER);
    expect(ledgerHits.hits.some((h) => h.code === "ledger_dump")).toBe(true);

    const domesticHits = auditHumanFeel(DOMESTIC);
    expect(domesticHits.hits.some((h) => h.code === "domestic_trivia")).toBe(true);
  });

  test("soft warn vs strict deny; AcceptPolicy composes", () => {
    const soft = HumanFeelGate.evaluateAccept({ body: TIDY, strictHuman: false });
    expect(soft.ok).toBe(true);
    expect(soft.messages.some((m) => m.code === "human_feel_hits")).toBe(true);

    const hard = HumanFeelGate.evaluateAccept({ body: TIDY, strictHuman: true });
    expect(hard.ok).toBe(false);
    expect(hard.messages[0]?.code).toBe("human_feel_strict");

    const cand = { lintHitCount: 0, body: TIDY } as CandidateFile;
    const allowed = AcceptPolicy.evaluate({
      candidate: cand,
      brief: null,
      payoff: null,
      skipBrief: true,
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.receiptLines.some((l) => l.includes("human_feel_hits"))).toBe(true);

    const text = HumanFeelAuditorPort.format("fixture", HumanFeelAuditorPort.audit(TIDY));
    expect(text).toContain("人味软雷达");
  });

  test("stiffness_tidy only when craft promises shatter; warn not deny", () => {
    const tidyMeaning = padBody(`
主角走进房间。他看见桌上的刀。他数了数刀痕。他明白了对方的计划。众人震惊地看着他。
他心中一清，一切都清楚了。这说明规则已经生效。由此可见对方在骗他。总而言之他赢了。
店里灯还亮着，他准备交班离开这里继续下一场。
`, 2);
    // no craftCue → skip stiffness_tidy
    const plain = auditHumanFeel(tidyMeaning);
    expect(plain.hits.some((h) => h.code === "stiffness_tidy")).toBe(false);

    const withCue = auditHumanFeel(tidyMeaning, {
      craftCue: "本场应落纸：信息侧漏；打断后留半截；别收成合格聪明主角",
    });
    expect(withCue.hits.some((h) => h.code === "stiffness_tidy")).toBe(true);
    const hit = withCue.hits.find((h) => h.code === "stiffness_tidy")!;
    expect(hit.text).toContain("偏僵硬收齐");

    const soft = HumanFeelGate.evaluateAccept({
      body: tidyMeaning,
      strictHuman: false,
      craftCue: "呼吸不齐；功能拍后留余震",
    });
    expect(soft.ok).toBe(true);
    expect(soft.messages.some((m) => m.text.includes("stiffness_tidy") || m.text.includes("偏僵硬"))).toBe(true);
  });
});
