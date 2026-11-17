import assert from "node:assert/strict";
import test from "node:test";
import { text } from "../support/v14.mjs";
test("精确与宽松精确引文 → 原文偏移覆盖全角字符", () => {
  const source = "　ＡＢ１２，雨落在旧港。\n\n灯火照亮码头。",
    result = text.segment(source, { format: "md" }),
    paras = result.segments[0].paras;
  const exact = text.locateQuote(source, paras, [paras[0].id], "雨落在旧港");
  assert.equal(exact.located, "exact");
  assert.equal(source.slice(exact.start, exact.end), "雨落在旧港");
  const loose = text.locateQuote(source, paras, [paras[0].id], "ab12雨落");
  assert.equal(loose.located, "exact");
  assert.equal(source.slice(loose.start, loose.end), "ＡＢ１２，雨落");
});
test("有效但错误的段号 → 在本块更正；全无效段号或编造引文 → false", () => {
  const source = "潮水退去。\n\n灯火照亮码头。",
    paras = text.segment(source, { format: "md" }).segments[0].paras;
  assert.equal(text.locateQuote(source, paras, [paras[0].id], "灯火照亮码头").para, paras[1].id);
  assert.equal(text.locateQuote(source, paras, ["missing"], "灯火照亮码头").located, false);
  assert.equal(text.locateQuote(source, paras, [paras[0].id], "飞船降落火星").located, false);
});
test("长句差一字且 Jaccard 达阈值 → fuzzy，返回命中句", () => {
  const source = "林川把手电压低沿着湿滑台阶走过夜色中的旧码头寻找那位失踪的守灯人。",
    paras = text.segment(source, { format: "txt" }).segments[0].paras;
  const quote = source.replace("手电", "火把");
  assert.ok(text.similar(source, quote) >= 0.8);
  const hit = text.locateQuote(source, paras, [paras[0].id], quote);
  assert.equal(hit.located, "fuzzy");
  assert.equal(hit.text, source);
});
