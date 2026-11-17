import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";
import { provenance, treeOps } from "../support/v14.mjs";

const { applyOutlineOps } = await importTs("packages/fanqie/src/outline/ops.ts");
const { OutlineOpSchema } = await importTs("packages/fanqie/src/outline/schema.ts");
const empty = () => ({
  book: { format: "zhizhang/1.3", title: "测试", volumeOrder: [], rev: 0 },
  volumes: new Map(),
});
const makeNode = (id, title = id) => ({ id, title, planStatus: "draft", provenance, rev: 0 });
const expectInvalid = (fn) => assert.throws(fn, (error) => error.code === "input.invalid");

test("大纲操作拒绝空 ID 集、越界索引与被 splice 静默截断的创建", () => {
  const { ops, ids } = treeOps(1, 1, 2),
    outline = applyOutlineOps(empty(), ops);
  expectInvalid(() => applyOutlineOps(outline, [{ type: "node.move", ids: [], index: 0 }]));
  expectInvalid(() =>
    applyOutlineOps(outline, [{ type: "node.move", ids: [ids[0], ids[0]], index: 0 }]),
  );
  expectInvalid(() =>
    applyOutlineOps(outline, [
      { type: "node.create", level: "volume", index: 2, node: makeNode("vol-abcdefgh") },
    ]),
  );
  expectInvalid(() =>
    applyOutlineOps(outline, [
      { type: "node.move", ids: [ids[0]], parent: "act-00000002", index: 3 },
    ]),
  );
});

test("拆分操作要求匹配节点层级并在非空两侧的边界拆分", () => {
  const { ops, ids } = treeOps(1, 1, 2),
    outline = applyOutlineOps(empty(), ops);
  const chapters = ids.map((id) => ({ ...makeNode(id, id) }));
  expectInvalid(() =>
    applyOutlineOps(outline, [{ type: "chapter.split", id: "vol-00000001", parts: chapters }]),
  );
  expectInvalid(() =>
    applyOutlineOps(outline, [{ type: "chapter.split", id: ids[0], parts: [chapters[0]] }]),
  );
  expectInvalid(() =>
    applyOutlineOps(outline, [
      { type: "act.split", id: "act-00000002", at: 0, newNode: makeNode("act-abcdefgh") },
    ]),
  );
  expectInvalid(() =>
    applyOutlineOps(outline, [
      { type: "act.split", id: "act-00000002", at: 2, newNode: makeNode("act-abcdefgh") },
    ]),
  );
  expectInvalid(() =>
    applyOutlineOps(outline, [
      { type: "volume.split", id: "act-00000002", at: 1, newNode: makeNode("vol-abcdefgh") },
    ]),
  );
});

test("合并只能接收不同且同层级、同父级的有效节点", () => {
  const { ops, ids } = treeOps(2, 1, 2),
    outline = applyOutlineOps(empty(), ops);
  const chapter = (id) => ({ ...makeNode(id, "合并章"), goal: "目标", conflict: "冲突" });
  expectInvalid(() =>
    applyOutlineOps(outline, [
      { type: "chapter.merge", ids: [ids[0]], into: chapter("pl-abcdefgh") },
    ]),
  );
  expectInvalid(() =>
    applyOutlineOps(outline, [
      { type: "chapter.merge", ids: [ids[0], ids[0]], into: chapter("pl-abcdefgh") },
    ]),
  );
  expectInvalid(() =>
    applyOutlineOps(outline, [{ type: "act.merge", ids: [ids[0], "act-00000002"] }]),
  );
  expectInvalid(() =>
    applyOutlineOps(outline, [{ type: "volume.merge", ids: ["vol-00000001", "vol-00000001"] }]),
  );
});

test("公开操作解析器也拒绝空移动、单章合并和无效拆分数量", () => {
  assert.throws(() => OutlineOpSchema({ type: "node.move", ids: [], index: 0 }));
  assert.throws(() => OutlineOpSchema({ type: "chapter.merge", ids: ["pl-abcdefgh"], into: {} }));
  assert.throws(() => OutlineOpSchema({ type: "chapter.split", id: "pl-abcdefgh", parts: [] }));
});
