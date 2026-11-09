import test from "node:test";
import assert from "node:assert/strict";
import { factChain } from "../../apps/desktop/out-test/article-facts.mjs";
const check = (body, source, claims) =>
  factChain(
    {
      journal: { record: { request: { line: "story" } } },
      model: async (...args) => args[6]({ claims }),
    },
    "facts",
    "method",
    { title: "标题", body },
    { text: source },
    { sourceRef: {}, material: [] },
  );
test("T123 事实证据下限允许短专名，数字须由引文原样支持", async () => {
  assert.equal(
    (await check("精卫", "精卫", [{ claim: "精卫", quote: "精卫", kind: "quotation" }])).claims
      .length,
    1,
  );
  await assert.rejects(
    check("补贴标准为每人3800元", "这一年补贴标准每人3800元", [
      { claim: "补贴标准为每人3800元", quote: "年", kind: "fact" },
    ]),
    /过短/,
  );
  await assert.rejects(
    check("补贴标准为每人3800元", "补贴标准调整以后每人领取", [
      { claim: "补贴标准为每人3800元", quote: "补贴标准调整以后", kind: "fact" },
    ]),
    /数字/,
  );
  const result = await check("精卫每天衔来3块石头", "精卫", [
    { claim: "精卫", quote: "精卫", kind: "quotation" },
  ]);
  assert.match(result.unverified.join(" "), /3/);
});
