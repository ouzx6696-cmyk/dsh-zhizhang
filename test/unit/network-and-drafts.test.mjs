import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { createNodeDraftBackend, readDraftFile, writeDraftFile } = await importTs(
  "packages/workbench/src/editor/index.ts",
);
const desk = await importBundle("test/support/desktop-entry.ts");

test("decodeSourceBytes 正确解码 UTF-8 与 GBK/GB18030 字节流", () => {
  const utf8 = Buffer.from("县城菜市场的账本记录", "utf8");
  assert.equal(desk.decodeSourceBytes(utf8, "text/html; charset=utf-8"), "县城菜市场的账本记录");

  // "你好" 的 GBK 编码为 0xC4 0xE3 0xBA 0xC3
  const gbkBytes = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  assert.equal(desk.decodeSourceBytes(gbkBytes, "text/html; charset=gb2312"), "你好");
  // 无声明 charset 时 UTF-8 fatal 失败后回退到 gb18030
  assert.equal(desk.decodeSourceBytes(gbkBytes, "text/html"), "你好");
});

test("extractReadableText 剔除导航与脚本噪音并保留段落换行与 HTML 实体", () => {
  const html = `
    <html>
      <head><style>.nav{display:none}</style><script>alert("noise")</script></head>
      <body>
        <nav><a href="/">首页</a></nav>
        <article>
          <h1>菜场三笔账</h1>
          <p>第一段&ldquo;成本&rdquo;核算&amp;对比。</p>
          <p>第二段换行<br/>继续说明&#65;。</p>
        </article>
        <footer>版权声明</footer>
      </body>
    </html>
  `;
  const text = desk.extractReadableText(html);
  assert.equal(text, "菜场三笔账\n第一段“成本”核算&对比。\n第二段换行\n继续说明A。");
});

test("workbench Node 后端以原子写入保存草稿且 writeDraftFile 支持可注入时钟", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-draft-"));
  try {
    const backend = createNodeDraftBackend();
    const fixedClock = () => 1700000000000;

    const savedAt = await writeDraftFile(dir, "ch-001", "第一章初稿", "rev-0", backend, fixedClock);
    assert.equal(savedAt, 1700000000000);

    const loaded = await readDraftFile(dir, "ch-001", backend);
    assert.ok(loaded !== null);
    assert.equal(loaded.text, "第一章初稿");
    assert.equal(loaded.baseRevision, "rev-0");
    assert.equal(loaded.savedAt, 1700000000000);

    const files = await fs.readdir(path.join(dir, ".zhizhang", "drafts"));
    assert.equal(
      files.some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
