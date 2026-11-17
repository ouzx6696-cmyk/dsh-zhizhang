import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { createIdSource } = await importTs("packages/core/src/id.ts");

test("注入固定字节 → 输出确定且为 8 位 Crockford base32", () => {
  const zeros = createIdSource(() => new Uint8Array([0, 0, 0, 0, 0]));
  assert.equal(zeros.next("vol"), "vol-00000000");

  const max = createIdSource(() => new Uint8Array([255, 255, 255, 255, 255]));
  assert.equal(max.next("ent"), "ent-ZZZZZZZZ");

  const seq = createIdSource(() => new Uint8Array([1, 2, 3, 4, 5]));
  assert.equal(seq.next("pl"), "pl-04106105");
});

test("一万次生成无重复且匹配 id 格式", () => {
  const source = createIdSource();
  const seen = new Set();
  const pattern = /^(vol|act|pl|ent|th|st|kn|ev|p|cs)-[0-9A-HJKMNP-TV-Z]{8}$/;
  for (let index = 0; index < 10_000; index += 1) {
    const id = source.next("ent");
    assert.match(id, pattern);
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
  assert.equal(seen.size, 10_000);
});

test("前缀为空或随机源长度不对 → internal，不静默降级", () => {
  assert.throws(
    () => createIdSource(() => new Uint8Array(4)).next("ent"),
    (err) => err.code === "internal",
  );
  assert.throws(
    () => createIdSource(() => new Uint8Array(5)).next(""),
    (err) => err.code === "internal",
  );
});
