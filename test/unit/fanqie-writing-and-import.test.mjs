import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { computeSerialBuffer } = await importTs("packages/fanqie/src/view/snapshot.ts");
const {
  decodeTextBuffer,
  decodeTextBufferWithEncoding,
  parseChineseNumber,
  splitLegacyChapters,
  splitLegacyChaptersDetailed,
} = await importTs("packages/fanqie/src/commands/import.ts");
const { stitchContinuation, verifyLockedPrefix } = await importTs(
  "packages/fanqie/src/pipelines/chapter/prepare.ts",
);
const { resolvePreviousTextMode } = await importTs(
  "packages/fanqie/src/pipelines/chapter/rules.ts",
);

test("番茄前文截断策略按档位与设置返回正确模式", () => {
  assert.deepEqual(resolvePreviousTextMode("full", "economy"), { kind: "full", maxChars: 6000 });
  assert.deepEqual(resolvePreviousTextMode("tail", "premium"), { kind: "tail", chars: 1800 });
  assert.deepEqual(resolvePreviousTextMode("auto", "economy"), { kind: "tail", chars: 1500 });
  assert.deepEqual(resolvePreviousTextMode("auto", "standard"), { kind: "full", maxChars: 4000 });
});

test("computeSerialBuffer 在未填已发章、存在中间缺口与跳号缺失时准确计算连载存稿", () => {
  const rows = [
    { id: "C001", position: 1, status: "final", wordCount: 3000 },
    { id: "C002", position: 2, status: "final", wordCount: 3200 },
    { id: "C003", position: 3, status: "final", wordCount: 4100 },
    { id: "C004", position: 4, status: "drafted", wordCount: 2800 },
    { id: "C005", position: 5, status: "final", wordCount: 4400 },
  ];

  // 未填 publishedThrough 时从第 1 章起算连续 final
  const fromStart = computeSerialBuffer(rows);
  assert.equal(fromStart.publishedThrough, null);
  assert.equal(fromStart.continuousFinalCount, 3);
  assert.equal(fromStart.continuousFinalChars, 10300);
  assert.equal(fromStart.publishableDays, null);
  assert.deepEqual(fromStart.postGapFinalChapters, ["C005"]);

  // publishedThrough = C002 时 C003 连续、C004 缺口、C005 位于缺口之后
  const afterC002 = computeSerialBuffer(rows, { publishedThrough: "C002" });
  assert.equal(afterC002.publishedThrough, "C002");
  assert.equal(afterC002.continuousFinalCount, 1);
  assert.equal(afterC002.continuousFinalChars, 4100);
  assert.equal(afterC002.publishableDays, null);
  assert.deepEqual(afterC002.postGapFinalChapters, ["C005"]);

  // dailyTargetChars = 4000 且连续存稿 8500 字 -> 可撑 2 天
  const withTarget = computeSerialBuffer(
    [
      { id: "C001", position: 1, status: "final", wordCount: 4200 },
      { id: "C002", position: 2, status: "final", wordCount: 4300 },
    ],
    { dailyTargetChars: 4000 },
  );
  assert.equal(withTarget.continuousFinalCount, 2);
  assert.equal(withTarget.continuousFinalChars, 8500);
  assert.equal(withTarget.publishableDays, 2);
  assert.deepEqual(withTarget.postGapFinalChapters, []);

  // 跳号缺失 C002 时 C003 必须计入 postGapFinalChapters
  const missingGap = computeSerialBuffer([
    { id: "C001", position: 1, status: "final", wordCount: 3000 },
    { id: "C003", position: 3, status: "final", wordCount: 3200 },
  ]);
  assert.equal(missingGap.continuousFinalCount, 1);
  assert.equal(missingGap.continuousFinalChars, 3000);
  assert.deepEqual(missingGap.postGapFinalChapters, ["C003"]);
});

test("parseChineseNumber、decodeTextBuffer 与 splitLegacyChapters 准确解析中文章号、编码、楔子与卷标", () => {
  assert.equal(parseChineseNumber("一"), 1);
  assert.equal(parseChineseNumber("十二"), 12);
  assert.equal(parseChineseNumber("一百零二"), 102);
  assert.equal(parseChineseNumber("205"), 205);
  assert.equal(parseChineseNumber("两千零三十五"), 2035);
  assert.equal(parseChineseNumber("非法"), null);

  const utf8Bom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("第一章 雨夜", "utf8"),
  ]);
  assert.equal(decodeTextBuffer(utf8Bom), "第一章 雨夜");
  assert.equal(decodeTextBufferWithEncoding(utf8Bom).encoding, "utf-8-bom");

  const gbkBytes = Uint8Array.from([0xb5, 0xda, 0x31, 0xd5, 0xc2]);
  assert.equal(decodeTextBuffer(gbkBytes), "第1章");
  assert.equal(decodeTextBufferWithEncoding(gbkBytes).encoding, "gb18030");

  const rawBook = [
    "第一百零二章 决战前夜",
    "林默握紧断剑，目光落在远处的钟楼。",
    "",
    "第3章 破局",
    "门外的脚步声戛然而止。",
  ].join("\n");
  const chunks = splitLegacyChapters(rawBook);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].number, 102);
  assert.equal(chunks[0].title, "第一百零二章 决战前夜");
  assert.ok(chunks[0].body.includes("林默握紧断剑"));
  assert.equal(chunks[1].number, 3);
  assert.equal(chunks[1].title, "第3章 破局");
  assert.ok(chunks[1].body.includes("脚步声戛然而止"));

  // 短楔子不丢弃、卷标题不误拆成独立章节、空章标题记录告警
  const withPreludeAndVolume = [
    "三百年前，天地灵气骤绝。",
    "",
    "第一卷 潜龙在渊",
    "",
    "第1章 初入青云",
    "少年推开山门。",
    "第2章 空白占位",
    "第3章 正式交锋",
    "剑光掠过青石台。",
  ].join("\n");
  const detailed = splitLegacyChaptersDetailed(withPreludeAndVolume);
  assert.equal(detailed.hasPrelude, true);
  assert.ok(detailed.preludeChars > 0 && detailed.preludeChars < 200);
  assert.deepEqual(detailed.emptyHeadings, ["第2章 空白占位"]);
  assert.equal(detailed.chunks.length, 3);
  assert.equal(detailed.chunks[0].kind, "prelude");
  assert.equal(detailed.chunks[0].title, "楔子");
  assert.equal(detailed.chunks[1].volume, "第一卷 潜龙在渊");
  assert.equal(detailed.chunks[1].title, "第1章 初入青云");
  assert.equal(detailed.chunks[2].volume, "第一卷 潜龙在渊");
});

test("stitchContinuation 保留已写前缀且对全前缀校验防篡改", () => {
  const prefix =
    "雨点拍在青石板上，林默把铜铃塞进袖口，听见院墙外传来急促的马蹄声。他没有点灯，只顺手拨开窗闩一条缝，借着闪电看见巷口停着两辆黑篷马车，车辕上挂着镇魔司的铁牌，雨水顺着铁牌边缘滴成细线。";
  const cont = stitchContinuation(
    prefix,
    { title: "雨夜来客", body: "推门而入的并非捕快，而是满身泥浆的掌柜。" },
    "默认章名",
  );
  assert.equal(cont.title, "雨夜来客");
  assert.equal(verifyLockedPrefix(prefix, cont.body), true);
  assert.ok(cont.body.endsWith("满身泥浆的掌柜。"));

  const alreadyIncluded = stitchContinuation(
    prefix,
    { title: "", body: `${prefix}\n\n后半段直接跟上。` },
    "默认章名",
  );
  assert.equal(alreadyIncluded.title, "默认章名");
  assert.equal(alreadyIncluded.body.split(prefix).length - 1, 1);

  // 模型复述了前段但篡改了后半句时，必须保留原始完整前缀，绝不丢弃
  const tamperedPrefix = prefix.replace("镇魔司的铁牌", "锦衣卫的腰牌");
  const guarded = stitchContinuation(
    prefix,
    { title: "雨夜来客", body: `${tamperedPrefix}\n\n新的续写正文。` },
    "默认章名",
  );
  assert.equal(verifyLockedPrefix(prefix, guarded.body), true);
  assert.ok(guarded.body.startsWith(prefix));
  assert.equal(verifyLockedPrefix(prefix, tamperedPrefix), false);
});
