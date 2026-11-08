import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadRenderer } from "../engine/helpers.mjs";
import { createRuntime } from "../engine/runtime.mjs";

test("渲染层单测通道：打包产物存在、可加载，并带源码映射", () => {
  const bundle = new URL("../../build/test-renderer.cjs", import.meta.url);
  assert.ok(existsSync(bundle));
  const renderer = loadRenderer(createRuntime().react);
  assert.equal(typeof renderer.workflowModel.stageRows, "function");
});
