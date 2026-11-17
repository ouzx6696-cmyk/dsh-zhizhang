import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { createFakeClock } from "../support/clock.mjs";

const desk = await importBundle("test/support/desktop-entry.ts");
const { createDraftService } = desk;

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zz-drafts-"));
  const clock = createFakeClock();
  let workspace = root;
  const service = createDraftService({ root: () => workspace, clock });
  const draftsDir = path.join(root, ".zhizhang", "drafts");
  return { service, draftsDir, setRoot: (next) => (workspace = next) };
}

async function expectInvalid(promise, reason) {
  await assert.rejects(promise, (error) => {
    assert.equal(desk.isAppError(error), true, `expected AppError, got ${error}`);
    assert.equal(error.code, "input.invalid", `expected input.invalid, got ${error.code}`);
    if (reason) assert.equal(error.data?.reason, reason, `expected reason ${reason}`);
    return true;
  });
}

test("写入草稿后重读 → 文本与 baseRevision 一致", async () => {
  const { service, draftsDir } = await setup();
  const key = "zhizhang:draft:" + JSON.stringify(["fanqie", null, "work", "chapter-1", "official"]);
  const saved = await service.write(key, "雨夜的第一稿。", "rev-1");
  assert.equal(typeof saved.savedAt, "number");

  const entry = await service.read(key);
  assert.ok(entry);
  assert.equal(entry.text, "雨夜的第一稿。");
  assert.equal(entry.baseRevision, "rev-1");
  assert.equal(entry.savedAt, saved.savedAt);

  const files = await fs.readdir(draftsDir);
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith(".json"));
});

test("同 key 并发写 → 串行执行，最后一次生效", async () => {
  const { service } = await setup();
  const key = "zhizhang:draft:" + JSON.stringify(["agent", "target-1"]);
  const writes = ["一", "二", "三", "四", "五"].map((text) => service.write(key, text, "rev"));
  await assert.doesNotReject(Promise.all(writes));
  const entry = await service.read(key);
  assert.equal(entry.text, "五");
});

test("草稿 >2 MB → input.invalid，reason draft_too_large", async () => {
  const { service, draftsDir } = await setup();
  const key = "zhizhang:draft:too-large";
  await expectInvalid(service.write(key, "字".repeat(1_200_000), "rev"), "draft_too_large");
  assert.equal(await service.read(key), null, "超长草稿不得落盘");
  await assert.rejects(fs.readdir(draftsDir), { code: "ENOENT" }, "目录不应被创建");
});

test("未配置写作文件夹 → input.invalid，reason no_workspace", async () => {
  const { service, setRoot } = await setup();
  setRoot(undefined);
  const key = "zhizhang:draft:any";
  await expectInvalid(service.read(key), "no_workspace");
  await expectInvalid(service.write(key, "正文", "rev"), "no_workspace");
  await expectInvalid(service.clear(key), "no_workspace");
  await expectInvalid(service.list(), "no_workspace");
});

test("clear 之后 read 返回 null；list 按 prefix 过滤并给出字节", async () => {
  const { service } = await setup();
  const chapterKey = "zhizhang:draft:" + JSON.stringify(["fanqie", "w", "c1", "official"]);
  const agentKey = "agent:" + JSON.stringify(["fanqie", "w"]);
  await service.write(chapterKey, "章节草稿", "rev");
  await service.write(agentKey, "助手输入", "rev");

  const all = await service.list();
  assert.equal(all.length, 2);
  assert.ok(all.every((item) => item.bytes > 0));
  assert.deepEqual(all.map((item) => item.key).sort(), [agentKey, chapterKey].sort());

  const agentOnly = await service.list("agent:");
  assert.deepEqual(
    agentOnly.map((item) => item.key),
    [agentKey],
  );

  await service.clear(chapterKey);
  assert.equal(await service.read(chapterKey), null);
  assert.equal((await service.list()).length, 1);
});

test("损坏的草稿文件 → 读取返回 null 且文件被清理", async () => {
  const { service, draftsDir } = await setup();
  const key = "zhizhang:draft:broken";
  await service.write(key, "原始草稿", "rev");
  const [name] = await fs.readdir(draftsDir);
  const filePath = path.join(draftsDir, name);
  await fs.writeFile(filePath, "{not-json", "utf8");

  assert.equal(await service.read(key), null);
  await assert.rejects(fs.readFile(filePath), { code: "ENOENT" });
});
