import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { isAppError } = await importTs("packages/core/src/errors/index.ts");
const { arr, bool, desc, int, lit, nullable, num, obj, opt, record, str, toJsonSchema } =
  await importTs("packages/core/src/schema/index.ts");
const { defineTool } = await importTs("packages/core/src/tool/index.ts");
const { methodFor } = await importTs("packages/core/src/methods/index.ts");
const { runPythonJson, runPythonScript } = await importTs("packages/core/src/python/index.ts");
const { FORMAT_VERSION } = await importTs("packages/core/src/paths.ts");
const { APP_VERSION } = await importTs("packages/core/src/version.ts");
const { resolveDraftTrack, selectBestDraftCandidate } = await importTs(
  "packages/toutiao/src/pipelines/article/rules.ts",
);
const { resolvePreviousTextMode } = await importTs(
  "packages/fanqie/src/pipelines/chapter/rules.ts",
);

test("v2.3 版本与 zhizhang/2.0 磁盘格式常量一致", () => {
  assert.equal(APP_VERSION, "2.3.0");
  assert.equal(FORMAT_VERSION, "zhizhang/2.0");
});

test("toJsonSchema 单源导出基本类型、可选字段、nullable、枚举与说明，defineTool 自动附带 jsonSchema", () => {
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

test("头条起稿赛道解析与多路起稿择优选择覆盖蓝图且规范的候选", () => {
  assert.equal(resolveDraftTrack({ genre: "微头条", driver: "新闻型" }), "micro");
  assert.equal(resolveDraftTrack({ genre: "深长图文", driver: "故事型" }), "story");
  assert.equal(resolveDraftTrack({ genre: "短图文", driver: "账本型" }), "news");

  const blueprint = {
    angle: "成本拆解",
    sections: [
      { heading: "一笔实在账", keyPoints: ["电费"] },
      { heading: "真正的拐点", keyPoints: ["时间"] },
    ],
  };
  const weak = "很短的草稿，没有标题也没有小标题。";
  const strong = [
    "# 菜市场三笔账算明白",
    "",
    "## 一笔实在账",
    "",
    "第一段内容足够扎实，交代人物与具体花费细节。".repeat(12),
    "",
    "第二段继续补充对比案例与现场细节。".repeat(12),
    "",
    "## 真正的拐点",
    "",
    "第三段转入趋势分析，给出可验证的数字逻辑。".repeat(12),
    "",
    "第四段收束全文，留出讨论空间。".repeat(12),
  ].join("\n");

  const picked = selectBestDraftCandidate([weak, strong], "菜市场三笔账算明白", blueprint);
  assert.equal(picked.index, 1);
  assert.equal(picked.draft, strong);
});

test("番茄前文截断策略按档位与设置返回正确模式", () => {
  assert.deepEqual(resolvePreviousTextMode("full", "economy"), { kind: "full", maxChars: 6000 });
  assert.deepEqual(resolvePreviousTextMode("tail", "premium"), { kind: "tail", chars: 1800 });
  assert.deepEqual(resolvePreviousTextMode("auto", "economy"), { kind: "tail", chars: 1500 });
  assert.deepEqual(resolvePreviousTextMode("auto", "standard"), { kind: "full", maxChars: 4000 });
});
