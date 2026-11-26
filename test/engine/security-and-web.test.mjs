import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";

const desk = await importBundle("test/support/desktop-entry.ts");

test("assertPublicEndpoint 屏蔽内网、回环、云元数据与非 HTTP(S) 地址，放行公网 API", async () => {
  const blocked = [
    "http://127.0.0.1:11434/v1",
    "http://localhost:8080/v1",
    "http://10.0.0.5/v1",
    "http://172.16.0.9/v1",
    "http://192.168.1.20/v1",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]:11434/v1",
    "http://[fe80::1]/v1",
    "file:///etc/passwd",
    "https://user:pass@api.example.com/v1",
  ];
  for (const url of blocked) {
    await assert.rejects(
      () => desk.assertPublicEndpoint(url),
      (err) => desk.isAppError(err, "input.invalid"),
      `应阻止非公网或非法端点：${url}`,
    );
  }
  await desk.assertPublicEndpoint("https://93.184.216.34/v1");
  await desk.assertPublicEndpoint("https://[2606:4700:4700::1111]/v1");
});

test("Web 预览口令门禁、缺少 Origin 拦截、内网模型端点屏蔽、真实导出下载与备份闭环", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-sec-web-"));
  const stateRoot = path.join(dir, "state");
  const workspaceRoot = path.join(dir, "workspace");
  const staticDir = path.join(dir, "static");
  await fs.mkdir(staticDir, { recursive: true });
  await fs.writeFile(
    path.join(staticDir, "index.html"),
    "<!doctype html><title>OK</title>",
    "utf8",
  );

  const srv = await desk.startWebPreviewServer({
    host: "127.0.0.1",
    port: 0,
    repoRoot: process.cwd(),
    stateRoot,
    workspaceRoot,
    staticDir,
    passcode: "top-secret-2026",
    allowPrivateModelEndpoints: false,
  });

  try {
    const addr = srv.server.address();
    const port = typeof addr === "object" && addr ? addr.port : srv.port;
    const base = `http://127.0.0.1:${port}`;

    // 1. /api/health 不暴露宿主机路径且声明 authRequired=true
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.authRequired, true);
    assert.equal("workspace" in health, false);

    // 2. 未带 Origin 且未带 X-Requested-With 被 403 拦截
    const noOriginRes = await fetch(`${base}/api/rpc/app.state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: [] }),
    });
    assert.equal(noOriginRes.status, 403);

    // 3. 带 X-Requested-With 但未解锁返回 401
    const unauthRpc = await fetch(`${base}/api/rpc/app.state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "zhizhang" },
      body: JSON.stringify({ args: [] }),
    });
    assert.equal(unauthRpc.status, 401);

    const unauthEvents = await fetch(`${base}/api/events`);
    assert.equal(unauthEvents.status, 401);

    const unauthExport = await fetch(`${base}/api/exports/demo.txt`);
    assert.equal(unauthExport.status, 401);

    // 4. 错误口令登录返回 401
    const badLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "zhizhang" },
      body: JSON.stringify({ passcode: "wrong" }),
    });
    assert.equal(badLogin.status, 401);

    // 5. 正确口令解锁并拿到内存 Bearer 令牌
    const okLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "zhizhang" },
      body: JSON.stringify({ passcode: "top-secret-2026" }),
    });
    assert.equal(okLogin.status, 200);
    const { token } = await okLogin.json();
    assert.ok(typeof token === "string" && token.length >= 32);

    const rpcCall = async (channel, args = []) => {
      const res = await fetch(`${base}/api/rpc/${encodeURIComponent(channel)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "zhizhang",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ args }),
      });
      assert.equal(res.status, 200);
      return res.json();
    };

    // 6. 解锁后拉取项目列表并测试 Web 导出复制 + 文件下载
    const listReply = await rpcCall("targets.list");
    assert.equal(listReply.ok, true);
    const work = listReply.value.find((item) => item.target.mode === "fanqie");
    assert.ok(work, "种子工作区应包含至少一部示例长篇");

    const copyReply = await rpcCall("export.save", [
      work.target,
      { format: "copy", finalOnly: false },
    ]);
    assert.equal(copyReply.ok, true);
    assert.equal(copyReply.value.copied, true);
    assert.ok(typeof copyReply.value.content === "string" && copyReply.value.content.length > 20);

    const txtReply = await rpcCall("export.save", [
      work.target,
      { format: "txt", finalOnly: false },
    ]);
    assert.equal(txtReply.ok, true);
    assert.ok(txtReply.value.downloadUrl?.startsWith("/api/exports/"));
    assert.ok(!txtReply.value.file.includes(dir), "Web 导出响应不应泄露宿主机绝对路径");

    const dlRes = await fetch(
      `${base}${txtReply.value.downloadUrl}?token=${encodeURIComponent(token)}`,
    );
    assert.equal(dlRes.status, 200);
    const dlText = await dlRes.text();
    assert.ok(dlText.length > 20);

    // 7. workbench.call 禁止将导出文件写到工作区和 exportDir 之外
    const escapeOut = path.join(dir, "outside-escaped.txt");
    const escapeReply = await rpcCall("workbench.call", [
      {
        command: "fanqie.book.export",
        input: { work: work.target.path, format: "txt", finalOnly: false, outPath: escapeOut },
      },
    ]);
    assert.equal(escapeReply.ok, false);
    assert.equal(escapeReply.error.code, "input.invalid");

    // 8. workflow.start 禁止 ledgerPath 越出写作文件夹
    const article = listReply.value.find((item) => item.target.mode === "toutiao");
    assert.ok(article, "种子工作区应包含至少一篇示例头条");
    const escapeLedger = await rpcCall("workflow.start", [
      article.target,
      {
        kind: "toutiao.article",
        request: {
          articleId: "demo",
          genre: "短图文",
          driver: "账本型",
          ledgerPath: path.join(dir, "outside-ledger.csv"),
        },
      },
    ]);
    assert.equal(escapeLedger.ok, false);
    assert.equal(escapeLedger.error.code, "input.invalid");

    // 9. Web 模式屏蔽内网/云元数据模型端点
    const privateCatalog = await rpcCall("models.catalog", [
      { api: "openai-completions", baseUrl: "http://127.0.0.1:11434/v1" },
    ]);
    assert.equal(privateCatalog.ok, false);
    assert.equal(privateCatalog.error.code, "input.invalid");

    const metaTest = await rpcCall("models.test", [
      {
        api: "openai-completions",
        baseUrl: "http://169.254.169.254/latest/meta-data/",
        model: "gpt-4o-mini",
        keyless: true,
      },
    ]);
    assert.equal(metaTest.ok, false);
    assert.equal(metaTest.error.code, "input.invalid");

    // 10. Web 模式备份落到独立 backups 目录且不泄露绝对路径
    const backupReply = await rpcCall("backup.start");
    assert.equal(backupReply.ok, true);
    assert.ok(backupReply.value.dir && !backupReply.value.dir.includes(dir));
    const backupEntries = await fs.readdir(path.join(stateRoot, "backups"));
    assert.ok(backupEntries.length >= 1, "应成功在 stateRoot/backups 下生成离线备份目录");
  } finally {
    await srv.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("createUpdaterAdapter 完整驱动检查、下载进度、就绪与安装状态机", async () => {
  const listeners = new Map();
  const emitDriver = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) fn(payload);
  };
  let installed = false;
  const driver = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    async checkForUpdates() {
      emitDriver("checking-for-update");
      emitDriver("update-available", { version: "0.9.0", releaseNotes: "修复若干问题" });
      return null;
    },
    async downloadUpdate() {
      emitDriver("download-progress", { percent: 42.4 });
      emitDriver("update-downloaded", { version: "0.9.0" });
      return [];
    },
    quitAndInstall() {
      installed = true;
    },
  };

  const pushed = [];
  const updater = desk.createUpdaterAdapter("0.8.0", driver, (event) => {
    if (event.kind === "updates") pushed.push(event.status);
  });
  assert.equal(driver.autoDownload, false);
  assert.deepEqual(await updater.handle("status"), { state: "idle", version: "0.8.0" });

  const afterCheck = await updater.handle("check");
  assert.equal(afterCheck.state, "available");
  assert.equal(afterCheck.next, "0.9.0");
  assert.equal(afterCheck.notes, "修复若干问题");

  const afterDownload = await updater.handle("download");
  assert.equal(afterDownload.state, "ready");
  assert.equal(afterDownload.next, "0.9.0");
  assert.ok(pushed.some((s) => s.state === "downloading" && s.percent === 42));

  const afterInstall = await updater.handle("install");
  assert.equal(afterInstall.state, "ready");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(installed, true);
});
