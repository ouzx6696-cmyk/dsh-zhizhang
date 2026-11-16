import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = async (path) => {
  const source = await readFile(path, "utf8");
  // 只看代码，不看注释：说明性文字允许提到 localStorage（表述“不再使用”）。
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
};

test("drafts.ts 源码 → 不含 localStorage", async () => {
  const source = await read("packages/workbench/src/editor/drafts.ts");
  assert.ok(!source.includes("localStorage"), "草稿模块不得再引用 localStorage");
});

test("编辑态与草稿钩子源码 → 不再引用 localStorage 草稿函数", async () => {
  const stash = await read("packages/workbench/src/client/shared/useDraftStash.ts");
  assert.ok(!stash.includes("localStorage"));
  const withoutStore = stash.replace(/DraftStore|draftStore/g, "");
  assert.ok(
    !/readDraft[^S]|writeDraft|clearDraft[^S]|otherDraftKeys/.test(withoutStore),
    "草稿钩子不得走旧 localStorage 读写函数",
  );

  const editor = await read("packages/workbench/src/client/shared/SourceEditor.tsx");
  assert.ok(!editor.includes("localStorage"));
});

test("prefs.ts → 不再提供 agentDraft 键，仅保留 zhizhang:draft:* 的清理入口", async () => {
  const prefs = await read("packages/workbench/src/client/shared/prefs.ts");
  assert.ok(!prefs.includes("agentDraft"));
  assert.ok(prefs.includes("clearLegacyDraftStorage"));
  assert.ok(prefs.includes('"zhizhang:draft:"'));
});

test("AgentPanel 源码 → 助手输入草稿走 DraftStore 而非 localStorage", async () => {
  const panel = await read("apps/desktop/src/renderer/features/agent/AgentPanel.tsx");
  assert.ok(!panel.includes("readPref"));
  assert.ok(!panel.includes("writePref"));
  assert.ok(panel.includes("draftStore"));
});
