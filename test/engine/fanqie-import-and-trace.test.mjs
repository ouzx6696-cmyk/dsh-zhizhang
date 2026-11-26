import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { isAppError } = await importTs("packages/core/src/errors/index.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { createBibleStore, traceEntityTimeline } = await importTs(
  "packages/fanqie/src/bible/index.ts",
);
const { commands, fanqieModule } = await importTs("packages/fanqie/src/index.ts");
const { createWork, importLegacyWork, listChapters, previewLegacyWork, readChapter, saveChapter } =
  commands;

test("traceEntityTimeline 按别名展开跨书串联并支持正文回查截断，助手工具保持 readonly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-trace-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const workPath = path.join(root, "book-trace");
    await createWork(workPath, { id: "book-trace", title: "回查测试" }, lock);
    const store = createBibleStore(lock, clock);
    const prov = { source: "author", at: clock.iso() };

    const pending = await store.propose(
      workPath,
      [
        {
          type: "entity.upsert",
          entity: {
            id: "ent-shen",
            kind: "character",
            name: "沈青蝉",
            aliases: ["青蝉", "沈师姐"],
            summary: "剑阁首徒",
            locked: [],
            provenance: prov,
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-shen-1",
            entity: "ent-shen",
            field: "伤势",
            value: "左肩中寒毒",
            since: 2,
            mode: "replace",
            status: "confirmed",
            provenance: prov,
          },
        },
        {
          type: "knowledge.set",
          row: {
            id: "kn-1",
            holder: "沈师姐",
            fact: "知晓黑市密道入口",
            level: "知情",
            since: 3,
          },
        },
        {
          type: "thread.upsert",
          thread: {
            id: "th-1",
            title: "寒毒解药",
            kind: "mystery",
            opened: 2,
            beats: [{ chapter: 4, kind: "push", note: "青蝉在药庐找到残方" }],
            status: "open",
          },
        },
        {
          type: "chapter.record",
          record: {
            chapter: "C001",
            position: 1,
            revision: "rev-001",
            summary: "沈青蝉雨夜出场救下主角",
            hook: "留下玉佩",
            emotion: "紧张",
            handoff: {
              ending: "离开客栈",
              openQuestions: [],
              positions: { 沈青蝉: "城北" },
              carried: [],
            },
          },
        },
      ],
      prov,
    );
    for (const item of pending) {
      await store.decide(workPath, item.id, "accept");
    }

    await saveChapter(
      workPath,
      {
        chapterId: "C001",
        title: "初逢",
        body: "雨水顺着檐角滴落，沈青蝉收剑入鞘，又听人喊了一声青蝉。",
      },
      lock,
    );
    await saveChapter(
      workPath,
      {
        chapterId: "C002",
        title: "寒毒",
        body: "药庐灯火微弱，沈师姐按住肩头伤处。",
      },
      lock,
    );

    const traced = await traceEntityTimeline(
      workPath,
      "青蝉",
      { includeBody: true, maxBodyHits: 2 },
      lock,
    );
    assert.equal(traced.matchedEntity?.id, "ent-shen");
    assert.ok(traced.terms.includes("沈青蝉"));
    assert.ok(traced.terms.includes("沈师姐"));
    assert.equal(traced.events[0].chapter, null, "全局实体事件应排在最前");
    assert.equal(traced.events[0].source, "entity");

    const chapterNums = traced.events.filter((e) => e.chapter !== null).map((e) => e.chapter);
    const sortedNums = [...chapterNums].sort((a, b) => a - b);
    assert.deepEqual(chapterNums, sortedNums, "章节事件应按章节升序排列");

    const sources = new Set(traced.events.map((e) => e.source));
    for (const src of ["entity", "chapter", "state", "knowledge", "thread", "body"]) {
      assert.ok(sources.has(src), `时间线应包含 ${src} 来源`);
    }
    assert.equal(traced.bodyHitsTruncated, true, "超过 maxBodyHits=2 时应标记截断");

    const tools = fanqieModule.tools("assistant", { mode: "fanqie", path: workPath });
    const traceTool = tools.find((t) => t.name === "fanqie_trace_entity");
    assert.ok(traceTool, "应注册 fanqie_trace_entity 工具");
    assert.equal(traceTool.readonly, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("traceEntityTimeline 对空白查询词抛出 input.invalid", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-trace-empty-"));
  try {
    let caught;
    try {
      await traceEntityTimeline(root, "   ");
    } catch (err) {
      caught = err;
    }
    assert.ok(isAppError(caught) && caught.code === "input.invalid");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("importLegacyWork 支持单 TXT、自然序目录、GB18030 无损原稿备份与切章预览且零模型调用", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-import-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const worksRoot = path.join(root, "works");
    await fs.mkdir(worksRoot, { recursive: true });

    const txtPath = path.join(root, "old-book.txt");
    await fs.writeFile(
      txtPath,
      [
        "第一章 废材退婚",
        "苏家大厅气氛凝重，退婚书拍在案上。",
        "",
        "第2章 逆袭觉醒",
        "丹田深处亮起一道青光。",
      ].join("\n"),
      "utf8",
    );
    const resTxt = await importLegacyWork(
      {
        worksRoot,
        workId: "legacy-txt",
        title: "旧书单文件",
        sourcePath: txtPath,
        sourceKind: "single_txt",
        allowedRoot: root,
      },
      lock,
      clock,
    );
    assert.equal(resTxt.chapterCount, 2);
    assert.deepEqual(resTxt.chapterIds, ["C001", "C002"]);

    const txtChapters = await listChapters(resTxt.workPath);
    assert.equal(txtChapters.length, 2);
    assert.equal(txtChapters[0].status, "final");
    const c1 = await readChapter(resTxt.workPath, "C001");
    assert.ok(c1.body.includes("退婚书拍在案上"));
    const bible = await createBibleStore(lock, clock).read(resTxt.workPath);
    assert.deepEqual(bible.entities, []);
    const backupTxt = await fs.readFile(path.join(resTxt.backupDir, "old-book.txt"), "utf8");
    assert.ok(backupTxt.includes("第一章 废材退婚"));

    const folderPath = path.join(root, "chapters-folder");
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(path.join(folderPath, "第10章 终局.md"), "# 终局之战\n\n尘埃落定。", "utf8");
    await fs.writeFile(path.join(folderPath, "第2章 启程.txt"), "背起行囊走出山村。", "utf8");
    await fs.writeFile(
      path.join(folderPath, "第1章 初醒.md"),
      "# 初醒\n\n推开木窗见晨光。",
      "utf8",
    );

    const resFolder = await importLegacyWork(
      {
        worksRoot,
        workId: "legacy-folder",
        title: "旧书分章目录",
        sourcePath: folderPath,
        sourceKind: "folder",
        allowedRoot: root,
        chapterStatus: "drafted",
      },
      lock,
      clock,
    );
    assert.equal(resFolder.chapterCount, 3);
    const folderChapters = await listChapters(resFolder.workPath);
    assert.equal(folderChapters[0].title, "初醒");
    assert.equal(folderChapters[1].title, "第2章 启程");
    assert.equal(folderChapters[2].title, "终局之战");
    assert.equal(folderChapters[0].status, "drafted");

    // GB18030 原字节无损备份 + previewLegacyWork + import-manifest.json
    const gbkPath = path.join(root, "gbk-book.txt");
    const gbkRaw = Buffer.from([
      0xb5, 0xda, 0x31, 0xd5, 0xc2, 0x20, 0xbf, 0xaa, 0xc6, 0xaa, 0x0a, 0xd5, 0xfd, 0xce, 0xc4,
      0xc4, 0xda, 0xc8, 0xdd, 0xa1, 0xa3,
    ]);
    await fs.writeFile(gbkPath, gbkRaw);
    const preview = await previewLegacyWork({
      sourcePath: gbkPath,
      sourceKind: "single_txt",
      allowedRoot: root,
    });
    assert.equal(preview.encoding, "gb18030");
    assert.equal(preview.chapterCount, 1);
    const resGbk = await importLegacyWork(
      {
        worksRoot,
        workId: "legacy-gbk",
        title: "旧书GBK",
        sourcePath: gbkPath,
        sourceKind: "single_txt",
        allowedRoot: root,
        chapterStatus: "drafted",
      },
      lock,
      clock,
    );
    const backupRaw = await fs.readFile(path.join(resGbk.backupDir, "gbk-book.txt"));
    assert.equal(Buffer.compare(backupRaw, gbkRaw), 0, "原稿备份必须保留原始 GB18030 字节");
    const manifest = JSON.parse(
      await fs.readFile(path.join(resGbk.backupDir, "import-manifest.json"), "utf8"),
    );
    assert.equal(manifest.encoding, "gb18030");
    assert.equal(manifest.chapterStatus, "drafted");
    assert.equal(manifest.chapters.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
