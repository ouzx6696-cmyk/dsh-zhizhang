import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUrl } from "./helpers.mjs";

const { statusInfo, statusLabel, statusTone } = await import(buildUrl("ui/src/status.js"));

test("长篇状态只显示作者可读标签", () => {
  assert.deepEqual(statusInfo("fanqie", "drafted"), { label: "草稿", tone: "neutral" });
  assert.equal(statusLabel("fanqie", "reviewed"), "已审");
  assert.equal(statusLabel("fanqie", "final"), "定稿");
  assert.equal(statusLabel("fanqie", "staged"), "待审");
  assert.equal(statusTone("fanqie", "final"), "success");
  assert.equal(statusLabel("fanqie", ""), "待规划");
  assert.equal(statusLabel("fanqie", "unknown_english_status"), "草稿");
});

test("头条状态使用同一张映射表", () => {
  assert.equal(statusLabel("toutiao", "初稿待改"), "待写");
  assert.equal(statusLabel("toutiao", "待验收"), "待验收");
  assert.equal(statusTone("toutiao", "验收退回"), "danger");
  assert.equal(statusLabel("toutiao", "已交稿"), "已交稿");
  assert.equal(statusLabel("toutiao", ""), "待写");
});
