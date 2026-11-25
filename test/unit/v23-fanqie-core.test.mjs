import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { loadProfile, methodFor } = await importTs("packages/core/src/methods/index.ts");
const { computeSerialBuffer } = await importTs("packages/fanqie/src/view/snapshot.ts");
const { decodeTextBuffer, parseChineseNumber, splitLegacyChapters } = await importTs(
  "packages/fanqie/src/commands/import.ts",
);
const { stitchContinuation } = await importTs("packages/fanqie/src/pipelines/chapter/prepare.ts");

const ROOT = process.cwd();
const BUILTIN_FANQIE_PROFILES = path.join(ROOT, "packages/fanqie/profiles");

test("T1: 番茄默认方案 stage-map 注入二阶 AI 腔、快爽五项审改与六大题材表", async () => {
  const profile = await loadProfile("fanqie", "default", { builtinDir: BUILTIN_FANQIE_PROFILES });
  assert.equal(profile.id, "default");

  const reviseMethod = methodFor(profile, "fanqie.chapter.revise");
  assert.ok(reviseMethod.text.includes("二阶 AI 腔"), "revise 阶段应包含二阶 AI 腔诊断规范");
  assert.ok(reviseMethod.text.includes("一阶 AI 腔"), "revise 阶段应包含一阶 AI 腔诊断规范");

  const reviewMethod = methodFor(profile, "fanqie.chapter.review");
  assert.ok(
    reviewMethod.text.includes("番茄快爽与打脸文五项专属审改"),
    "review 阶段应包含番茄快爽五项专属审改",
  );
  const selectMethod = methodFor(profile, "fanqie.chapter.select");
  assert.ok(selectMethod.text.includes("盲评"), "select 阶段应包含双稿盲评口径");

  const cardMethod = methodFor(profile, "fanqie.book.card");
  assert.ok(cardMethod.text.includes("脑洞"), "book.card 阶段应挂载 genres.md 题材表");
  assert.ok(cardMethod.text.includes("战神"), "book.card 阶段应覆盖六大题材节奏基准");

  const draftMethod = methodFor(profile, "fanqie.chapter.draft");
  assert.ok(
    draftMethod.text.includes("手机屏实操示范") || draftMethod.text.includes("移动端"),
    "draft 阶段应包含移动端示范示例",
  );
});

test("T4: computeSerialBuffer 在未填已发章、存在中间缺口与设置日更字数时计算准确", () => {
  const rows = [
    { id: "C001", position: 1, status: "final", wordCount: 3000 },
    { id: "C002", position: 2, status: "final", wordCount: 3200 },
    { id: "C003", position: 3, status: "final", wordCount: 4100 },
    { id: "C004", position: 4, status: "drafted", wordCount: 2800 },
    { id: "C005", position: 5, status: "final", wordCount: 4400 },
  ];

  // Case 1: publishedThrough 未填 -> 从第 1 章起算连续 final
  const fromStart = computeSerialBuffer(rows);
  assert.equal(fromStart.publishedThrough, null);
  assert.equal(fromStart.continuousFinalCount, 3);
  assert.equal(fromStart.continuousFinalChars, 10300);
  assert.equal(fromStart.publishableDays, null);
  assert.deepEqual(fromStart.postGapFinalChapters, ["C005"]);

  // Case 2: publishedThrough = C002 -> C003 连续、C004 缺口、C005 位于缺口之后
  const afterC002 = computeSerialBuffer(rows, { publishedThrough: "C002" });
  assert.equal(afterC002.publishedThrough, "C002");
  assert.equal(afterC002.continuousFinalCount, 1);
  assert.equal(afterC002.continuousFinalChars, 4100);
  assert.equal(afterC002.publishableDays, null);
  assert.deepEqual(afterC002.postGapFinalChapters, ["C005"]);

  // Case 3: dailyTargetChars = 4000 且连续存稿 8500 字 -> 可撑 2 天
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
});

test("T5: parseChineseNumber、decodeTextBuffer 与 splitLegacyChapters 准确解析中文章号与编码", () => {
  assert.equal(parseChineseNumber("一"), 1);
  assert.equal(parseChineseNumber("十二"), 12);
  assert.equal(parseChineseNumber("一百零二"), 102);
  assert.equal(parseChineseNumber("205"), 205);
  assert.equal(parseChineseNumber("两千零三十五"), 2035);
  assert.equal(parseChineseNumber("非法"), null);

  // UTF-8 with BOM
  const utf8Bom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("第一章 雨夜", "utf8"),
  ]);
  assert.equal(decodeTextBuffer(utf8Bom), "第一章 雨夜");

  // GB18030 raw bytes for "第1章" (GBK: B5 DA 31 D5 C2)
  const gbkBytes = Uint8Array.from([0xb5, 0xda, 0x31, 0xd5, 0xc2]);
  assert.equal(decodeTextBuffer(gbkBytes), "第1章");

  // Single TXT with mixed Chinese & Arabic chapter headings
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
});

test("T2: stitchContinuation 保留已写前缀且不重复拼接", () => {
  const prefix = "雨点拍在青石板上，林默把铜铃塞进袖口，听见院墙外传来急促的马蹄声。";
  const cont = stitchContinuation(
    prefix,
    { title: "雨夜来客", body: "推门而入的并非捕快，而是满身泥浆的掌柜。" },
    "默认章名",
  );
  assert.equal(cont.title, "雨夜来客");
  assert.ok(cont.body.startsWith(prefix));
  assert.ok(cont.body.endsWith("满身泥浆的掌柜。"));

  // 如果模型已经把前缀原样带在开头，不应重复拼接
  const alreadyIncluded = stitchContinuation(
    prefix,
    { title: "", body: `${prefix}\n\n后半段直接跟上。` },
    "默认章名",
  );
  assert.equal(alreadyIncluded.title, "默认章名");
  assert.equal(alreadyIncluded.body.split(prefix).length - 1, 1);
});
