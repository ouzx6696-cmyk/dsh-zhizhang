import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";
const { segment, SegmentSchema, ParaSchema } = await importTs("packages/core/src/text/index.ts");

function validate(text, result) {
  const ids = new Set();
  for (const item of result.segments) {
    SegmentSchema(item);
    assert.ok(item.start <= item.end && item.end <= text.length);
    for (const para of item.paras) {
      ParaSchema(para);
      assert.ok(!ids.has(para.id));
      ids.add(para.id);
      assert.ok(para.start >= item.start && para.end <= item.end && para.start < para.end);
      assert.equal(
        para.hash,
        createHash("sha256").update(text.slice(para.start, para.end)).digest("hex").slice(0, 12),
      );
    }
  }
}

test("TXT 卷、幕、章 → 语义层级与父路径，标题前归 S0", () => {
  const text =
    "这里是前言。\n\n第一卷 起航\n\n第一幕 潮声\n\n第一章 夜港\n甲。\n乙。\n\n第二章 天明\n丙。\n\n第二卷 归途\n";
  const result = segment(text, { format: "txt" });
  validate(text, result);
  assert.deepEqual(
    result.segments.map((s) => s.id),
    ["S0", "S1", "S2", "S3", "S4", "S5"],
  );
  assert.deepEqual(
    result.segments.map((s) => s.level),
    [1, 1, 2, 3, 3, 1],
  );
  assert.deepEqual(result.segments[4].titlePath, ["第一卷 起航", "第一幕 潮声", "第二章 天明"]);
  assert.equal(result.segments[3].hint, "outline-chapter");
});

test("TXT 编号样式按首次出现定 4–6 级，关键词与括号标题可识别", () => {
  const text = "一、概览\n\n（ 一 ）正文不匹配。\n\n（四）事项\n\n①条目\n\n【人物】\n\n正文。";
  const result = segment(text, { format: "txt" });
  validate(text, result);
  assert.deepEqual(
    result.segments.map((s) => s.level),
    [4, 5, 6, 6],
  );
  assert.equal(result.segments.at(-1).hint, "setting-character");
});

test("TXT 作者改映射与忽略 → 从同一原文零费用重新分节", () => {
  const text = "第一卷 起航\n\n第二章 晚潮\n正文。";
  const result = segment(text, {
    format: "txt",
    rules: { act: ["第一卷 起航"], ignore: ["第二章 晚潮"] },
  });
  validate(text, result);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].semantic, "act");
  assert.equal(result.segments[0].level, 2);
  assert.ok(result.segments[0].paras.some((p) => text.slice(p.start, p.end).includes("第二章")));
});

test("TXT 全角缩进占比或无空行短行 → 一行一段；其他按空行", () => {
  for (const [text, count] of [
    ["　　甲\n　　乙\n\n　　丙", 3],
    ["甲\n乙\n丙", 3],
    ["甲\n乙\n\n丙", 2],
  ]) {
    const result = segment(text, { format: "txt" });
    validate(text, result);
    assert.equal(result.segments[0].id, "S1");
    assert.equal(result.segments[0].paras.length, count);
  }
});

test("MD ATX、Setext、表格与多行列表项 → 独立段落与精确原文偏移", () => {
  const text =
    "# 概览\r\n第一段\r\n续行\r\n\r\n人物表\r\n------\r\n| 名字 | 身份 |\r\n| --- | --- |\r\n| 甲 | 船家 |\r\n\r\n- 第一项\r\n  续行\r\n- 第二项\r\n";
  const result = segment(text, { format: "md" });
  validate(text, result);
  assert.deepEqual(
    result.segments.map((s) => [s.title, s.level]),
    [
      ["概览", 1],
      ["人物表", 2],
    ],
  );
  assert.equal(result.segments[1].hint, "setting-character");
  assert.deepEqual(
    result.segments[1].paras.map((p) => text.slice(p.start, p.end)),
    ["| 名字 | 身份 |", "| --- | --- |", "| 甲 | 船家 |", "- 第一项\r\n  续行", "- 第二项"],
  );
});

test("MD YAML front matter → meta 节；围栏中的 # 不作为标题", () => {
  const text = "---\ntitle: 测试\n---\n# 正文\n```md\n# 示例\n```\n\n甲。\n";
  const result = segment(text, { format: "md" });
  validate(text, result);
  assert.deepEqual(
    result.segments.map((s) => s.title),
    ["meta", "正文"],
  );
  assert.equal(result.segments[0].hint, "meta");
  assert.equal(
    text.slice(result.segments[0].paras[0].start, result.segments[0].paras[0].end),
    "---\ntitle: 测试\n---",
  );
});

test("MD 作者映射使用显示标题，忽略不会吞掉后续正文", () => {
  const text = "# 概览\n\n## 人物\n甲。";
  const result = segment(text, { format: "md", rules: { chapter: ["概览"], ignore: ["人物"] } });
  validate(text, result);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].semantic, "chapter");
  assert.ok(text.slice(result.segments[0].paras[0].start).includes("甲。"));
});

test("空文无节；无标题文本全归 S1；正文句末标点避免误判标题", () => {
  assert.deepEqual(segment("\n　\n", { format: "txt" }).segments, []);
  const text = "第一章故事说完了。\n\n只是普通正文。";
  const result = segment(text, { format: "txt" });
  validate(text, result);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].title, "");
  assert.equal(result.segments[0].paras.length, 2);
});

test("重复分节 → 段号、hash 与偏移可复现；1 MB 文本记录耗时", (t) => {
  const text = Array.from(
    { length: 4000 },
    (_, i) => `第${i + 1}章 夜港\n${"雨落在旧港，灯火渐次亮起。".repeat(24)}\n\n`,
  ).join("");
  const started = performance.now();
  const result = segment(text, { format: "txt" });
  t.diagnostic(
    `${Buffer.byteLength(text)} bytes, segment ${(performance.now() - started).toFixed(1)} ms`,
  );
  assert.equal(result.segments.length, 4000);
  assert.deepEqual(segment(text, { format: "txt" }), result);
  validate(text, result);
});

test("MD 元数据后无标题正文 → 独立 S0 前言，不混进 meta 区", () => {
  const text = "---\ntitle: 样例\n---\n\n前言第一段。\n\n# 正文\n这是正文。";
  const result = segment(text, { format: "md" });
  validate(text, result);
  assert.deepEqual(
    result.segments.map((s) => [s.id, s.title]),
    [
      ["S1", "meta"],
      ["S0", "前言"],
      ["S2", "正文"],
    ],
  );
  assert.equal(result.segments[0].paras.length, 1);
  assert.equal(result.segments[0].end, text.indexOf("\n\n前言") + 1);
});

test("MD 六级 ATX、一级 Setext 与同级标题 → 正确结束父路径", () => {
  const text = "顶层\n====\n\n## 小节\n\n###### 末层\n\n## 并列\n";
  const result = segment(text, { format: "md" });
  validate(text, result);
  assert.deepEqual(
    result.segments.map((s) => s.level),
    [1, 2, 6, 2],
  );
  assert.deepEqual(result.segments.at(-1).titlePath, ["顶层", "并列"]);
});

test("标题或首段关键词 → 覆盖设定、时间线与大纲 hint", () => {
  for (const [keyword, hint] of [
    ["角色", "setting-character"],
    ["宗门", "setting-faction"],
    ["地点", "setting-place"],
    ["功法", "setting-power"],
    ["道具", "setting-item"],
    ["世界观", "setting-rule"],
    ["年表", "timeline"],
    ["卷", "outline-volume"],
    ["幕", "outline-act"],
    ["章", "outline-chapter"],
  ]) {
    const text = `# 概览\n${keyword}资料。`;
    assert.equal(segment(text, { format: "md" }).segments[0].hint, hint);
  }
});
