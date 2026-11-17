import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";
const { normalize } = await importTs("packages/core/src/text/index.ts");

test("CRLF / CR、BOM、约定不可见字符与行尾空白 → 规范正文", () => {
  const input = "\uFEFF甲\u00A0乙\u200B\u200C\u200D\uFEFF  \r\n丙\t\r丁　\n\n \t\n\n戊  ";
  assert.deepEqual(normalize(input), { text: "甲乙\n丙\n丁\n\n戊" });
});

test("全角字母、圈号与兼容字 → 不做 NFKC，正文逐字保留", () => {
  const input = "　　ＡＢＣ１２３①ﬀ㍻😀\n缩进保留。";
  assert.equal(normalize(input).text, input);
});

test("调试偏移映射 → 按 UTF-16 单元回指原文，CRLF 换行指向 CR", () => {
  const input = "\uFEFF甲\u200B😀 \r\n\n \n乙\t";
  const result = normalize(input, { map: true });
  assert.equal(result.text, "甲😀\n\n乙");
  assert.ok(result.map instanceof Int32Array);
  assert.equal(result.map.length, result.text.length);
  assert.deepEqual([...result.map], [1, 3, 4, 6, 8, 11]);
  for (let i = 0; i < result.text.length; i++) {
    const source = input[result.map[i]];
    assert.equal(source === "\r" ? "\n" : source, result.text[i]);
  }
});

test("空文、纯空白与连续空行 → 规范化幂等，默认不创建映射", () => {
  for (const input of ["", " \t　", "\r\n\r\n\r\n", "A \n \n \nB\r"]) {
    const result = normalize(input);
    assert.deepEqual(normalize(result.text), result);
    assert.equal("map" in result, false);
  }
});
