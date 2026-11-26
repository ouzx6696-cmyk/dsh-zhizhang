import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { isAppError } = await importTs("packages/core/src/errors/index.ts");
const { arr, bool, desc, int, lit, nullable, num, obj, opt, record, str, toJsonSchema } =
  await importTs("packages/core/src/schema/index.ts");
const { defineTool } = await importTs("packages/core/src/tool/index.ts");
const { methodFor } = await importTs("packages/core/src/methods/index.ts");
const { runPythonJson, runPythonScript } = await importTs("packages/core/src/python/index.ts");

test("toJsonSchema 导出基本类型、可选字段、nullable、枚举与说明，defineTool 自动附带 jsonSchema", () => {
  const ParamsSchema = obj({
    chapterId: desc(str({ min: 1 }), "章节编号"),
    limit: opt(desc(int({ min: 1, max: 50 }), "最大条数")),
    mode: lit("fast", "full"),
    score: nullable(num()),
    tags: arr(str()),
    flags: record(bool),
  });

  const schema = toJsonSchema(ParamsSchema);
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["chapterId", "mode", "score", "tags", "flags"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.chapterId, {
    type: "string",
    minLength: 1,
    description: "章节编号",
  });
  assert.deepEqual(schema.properties.limit, {
    type: "integer",
    minimum: 1,
    maximum: 50,
    description: "最大条数",
  });
  assert.deepEqual(schema.properties.mode, { type: "string", enum: ["fast", "full"] });
  assert.deepEqual(schema.properties.score, { anyOf: [{ type: "number" }, { type: "null" }] });
  assert.deepEqual(schema.properties.tags, { type: "array", items: { type: "string" } });
  assert.deepEqual(schema.properties.flags, {
    type: "object",
    additionalProperties: { type: "boolean" },
  });

  const tool = defineTool({
    name: "sample_tool",
    description: "示例工具",
    roles: ["assistant"],
    params: ParamsSchema,
    run: async () => ({ ok: true }),
  });
  assert.deepEqual(tool.jsonSchema, schema);
});

test("methodFor 支持带 when 条件的动态赛道路由并按匹配项拼接方法文档", () => {
  const profile = {
    id: "default",
    name: "默认",
    mode: "toutiao",
    hash: "h0",
    files: {
      "base.md": "通用原则",
      "news.md": "新闻赛道指南",
      "story.md": "故事赛道指南",
      "micro.md": "微头条指南",
    },
    stageMap: {
      "toutiao.article.draft": {
        take: [
          { file: "base.md" },
          { file: "news.md", when: { draftTrack: "news" } },
          { file: "story.md", when: { draftTrack: "story" } },
          { file: "micro.md", when: { draftTrack: "micro" } },
        ],
      },
    },
  };

  assert.equal(
    methodFor(profile, "toutiao.article.draft", { draftTrack: "story" }).text,
    "通用原则\n\n故事赛道指南",
  );
  assert.equal(
    methodFor(profile, "toutiao.article.draft", { draftTrack: "micro" }).text,
    "通用原则\n\n微头条指南",
  );
  assert.equal(methodFor(profile, "toutiao.article.draft", {}).text, "通用原则");
});

test("PythonRunner 支持可插拔 executor、强制 Schema 校验以及 AbortSignal 立即中止", async () => {
  const fakeExecutor = {
    runScript: async () => ({
      code: 0,
      stdout: JSON.stringify({ ok: true, count: 3 }),
      stderr: "",
    }),
  };

  const parsed = await runPythonJson("dummy.py", [], obj({ ok: bool, count: int() }), {
    executor: fakeExecutor,
  });
  assert.deepEqual(parsed, { ok: true, count: 3 });

  await assert.rejects(
    () =>
      runPythonJson("dummy.py", [], obj({ ok: bool, count: int() }), {
        executor: {
          runScript: async () => ({
            code: 0,
            stdout: JSON.stringify({ ok: "bad-type" }),
            stderr: "",
          }),
        },
      }),
    (err) => isAppError(err, "python.failed"),
  );

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => runPythonScript("dummy.py", [], { signal: ac.signal }),
    (err) => isAppError(err, "run.stopped"),
  );
});
