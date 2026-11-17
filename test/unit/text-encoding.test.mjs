import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { detectEncoding, EncodingGuessSchema } = await importTs("packages/core/src/text/index.ts");

for (const [file, encoding, confidence, marker] of [
  ["utf8-bom.bin", "utf-8", 1, "晨光"],
  ["utf16be.bin", "utf-16be", 1, "北岸灯塔"],
  ["big5.bin", "big5", 0.98, "燈火"],
  ["gb18030-rare.bin", "gb18030", 0.98, "龘"],
  ["ascii.bin", "utf-8", 0.99, "plain ASCII"],
]) {
  test(`${file} → 编码与置信度正确，解码无替换字符`, async () => {
    const bytes = await readFile(`test/fixtures/text/${file}`);
    const guess = EncodingGuessSchema(detectEncoding(bytes));
    assert.equal(guess.encoding, encoding);
    assert.equal(guess.confidence, confidence);
    const decoded = new TextDecoder(guess.encoding, { fatal: true }).decode(bytes);
    assert.ok(decoded.includes(marker));
    assert.ok(!decoded.includes("\uFFFD"));
    assert.ok(guess.candidates.every((candidate) => [...candidate.preview].length <= 400));
  });
}

test("UTF-16LE BOM → 置信度 1；无 BOM 大小端零字节比例 → 0.95", () => {
  const le = Buffer.from("A灯塔B\nC旧港D", "utf16le");
  const withBom = detectEncoding(Buffer.concat([Buffer.from([0xff, 0xfe]), le]));
  assert.equal(withBom.encoding, "utf-16le");
  assert.equal(withBom.bom, true);
  assert.equal(withBom.confidence, 1);
  for (const [bytes, encoding] of [
    [le, "utf-16le"],
    [Buffer.from(le).swap16(), "utf-16be"],
  ]) {
    const guess = detectEncoding(bytes);
    assert.equal(guess.encoding, encoding);
    assert.equal(guess.bom, false);
    assert.equal(guess.confidence, 0.95);
  }
});

test("无 BOM UTF-8 与空输入 → 严格 UTF-8 分支优先，置信度 0.99", () => {
  for (const value of ["", "晨光里的旧港，船靠岸了。", "hello"]) {
    assert.deepEqual(detectEncoding(Buffer.from(value)), {
      encoding: "utf-8",
      confidence: 0.99,
      bom: false,
      candidates: [{ encoding: "utf-8", score: 0.99, preview: value }],
    });
  }
});

test("GB18030 与 Big5 都能解且分差小 → 低置信度并保留两个候选", () => {
  // B1 DF 分别解为简体“边”和繁体“晚”，两者高频字比例相同。
  const guess = EncodingGuessSchema(detectEncoding(Uint8Array.of(0xb1, 0xdf)));
  assert.ok(guess.confidence <= 0.7);
  assert.deepEqual(
    guess.candidates.slice(0, 2).map((candidate) => candidate.encoding),
    ["gb18030", "big5"],
  );
  assert.equal(guess.candidates[0].score, guess.candidates[1].score);
});

test("没有可信候选 → input.invalid，附三种编码预览", () => {
  assert.throws(
    () => detectEncoding(Uint8Array.of(0xff, 0xff, 0xff)),
    (error) => {
      assert.equal(error.code, "input.invalid");
      assert.equal(error.data.reason, "encoding_unsupported");
      assert.equal(error.data.candidates.length, 3);
      return true;
    },
  );
});

test("UTF-8 尾部超过采样窗口才损坏 → 不能被误判为严格 UTF-8", () => {
  const bytes = Buffer.concat([Buffer.from("a".repeat(70000)), Buffer.from([0xff])]);
  assert.throws(
    () => detectEncoding(bytes),
    (error) => error.data.reason === "encoding_unsupported",
  );
});

test("预览包含非 BMP 字符 → 不截断代理对且满足运行时 schema", () => {
  const guess = EncodingGuessSchema(detectEncoding(Buffer.from("甲" + "😀".repeat(500))));
  const preview = guess.candidates[0].preview;
  assert.ok(preview.length <= 400);
  assert.ok(!/[\uD800-\uDBFF]$/u.test(preview));
});

test("64 KB 样本在多字节字符中间结束 → 不引入人为替换字符扣分", () => {
  const pair = Buffer.from([0xb1, 0xdf]);
  const bytes = Buffer.concat([Buffer.from("x"), ...Array(32768).fill(pair)]);
  const guess = detectEncoding(bytes);
  assert.equal(guess.candidates[0].score, 0.6);
  assert.equal(guess.candidates[1].score, 0.6);
});
