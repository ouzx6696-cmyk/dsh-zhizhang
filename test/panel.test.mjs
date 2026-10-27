/** Author-facing panel reads, explicit acceptance and its HTTP boundary. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { networkInterfaces } from "node:os";
import { saveChapter, setOutline, stageCandidate, markCandidateLinted, recordBriefBreadcrumb, readChapter } from "../dist/lib/store.js";
import { createPanelApiHandler } from "../dist/lib/http-api.js";
import { jpost, servePanel, withWork } from "./helpers.mjs";
function fakeRequest(options) {
    const req = new EventEmitter();
    req.method = options.method ?? "GET";
    req.url = options.url ?? "/api/dsh-zhizhang/works";
    req.headers = { host: "localhost", ...options.headers };
    req.socket = { remoteAddress: options.remoteAddress ?? "127.0.0.1" };
    const res = { status: 0, payload: null, writeHead(status) { this.status = status; }, end(body) { this.payload = JSON.parse(body); } };
    return { req, res };
}
function lanAddress() {
    for (const interfaces of Object.values(networkInterfaces()))
        for (const item of interfaces ?? [])
            if (!item.internal && item.family === "IPv4")
                return item.address;
    return "192.168.1.9";
}
test("面板快照不含正文，按需读章返回原文", async () => {
    const work = await withWork("面板阅读");
    const server = await servePanel({ storageRoot: work.base });
    try {
        await saveChapter(work.dir, { id: "c001", title: "一", body: "作者正文", status: "drafted" });
        await stageCandidate(work.dir, { chapterId: "c001", body: "候选正文" });
        const snapshot = await (await fetch(`${server.api}/snapshot?work=${encodeURIComponent(work.key)}`)).json();
        assert.equal(snapshot.ok, true);
        assert.equal(snapshot.snapshot.totals.chapters, 1);
        assert.equal("body" in snapshot.snapshot.chapters[0], false);
        assert.equal("body" in snapshot.snapshot.candidates[0], false);
        const chapter = await (await fetch(`${server.api}/chapter?work=${encodeURIComponent(work.key)}&id=c001`)).json();
        assert.equal(chapter.body, "作者正文");
        const bad = await fetch(`${server.api}/candidate?work=${encodeURIComponent(work.key)}&id=${encodeURIComponent("../x")}`);
        assert.equal(bad.status, 400);
        assert.equal((await bad.json()).code, "bad_id");
    }
    finally {
        await server.close();
        await work.cleanup();
    }
});
test("面板采纳须明确确认并写入所选候选", async () => {
    const work = await withWork("面板采纳");
    const server = await servePanel({ storageRoot: work.base });
    try {
        await setOutline(work.dir, "c001", { ending: "门开了" }, "第一章");
        await recordBriefBreadcrumb(work.dir, { chapterId: "c001", assetIds: [] });
        const candidate = await stageCandidate(work.dir, { chapterId: "c001", body: "她推开门。" });
        await markCandidateLinted(work.dir, candidate.id, 0);
        for (const confirm of [undefined, 1, "true"]) {
            const response = await jpost(server.api, "/candidate/accept", { work: work.key, candidate: candidate.id, confirm });
            assert.equal(response.status, 400);
            assert.equal((await response.json()).code, "confirm_required");
        }
        const invalid = await jpost(server.api, "/candidate/accept", { work: work.key, candidate: candidate.id, confirm: true, mode: "merge" });
        assert.equal((await invalid.json()).code, "bad_mode");
        const accepted = await jpost(server.api, "/candidate/accept", { work: work.key, candidate: candidate.id, confirm: true });
        assert.equal(accepted.status, 200);
        assert.equal((await readChapter(work.dir, "c001")).body, "她推开门。");
    }
    finally {
        await server.close();
        await work.cleanup();
    }
});
test("面板拒绝不可信来源、非 JSON 写入和未授权局域网访问", async () => {
    const work = await withWork("面板安全");
    const server = await servePanel({ storageRoot: work.base });
    try {
        const wrongType = await fetch(`${server.api}/candidate/accept`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
        assert.equal(wrongType.status, 415);
        assert.equal((await fetch(`${server.api}/works`, { headers: { origin: "http://evil.example" } })).status, 403);
        const rebound = fakeRequest({ headers: { host: "rebind.example", origin: "http://rebind.example" } });
        await createPanelApiHandler({ storageRoot: work.base })(rebound.req, rebound.res);
        assert.equal(rebound.res.status, 403);
        const tokenless = fakeRequest({ headers: { host: "localhost" } });
        await createPanelApiHandler({ storageRoot: work.base, panelToken: "secret" })(tokenless.req, tokenless.res);
        assert.equal(tokenless.res.status, 403);
        const local = lanAddress();
        const deny = fakeRequest({ remoteAddress: local });
        await createPanelApiHandler({ storageRoot: work.base })(deny.req, deny.res);
        assert.equal(deny.res.status, 403);
        const config = { storageRoot: work.base, allowLanPanel: true, panelHosts: ["panel.lan"], panelToken: "test-token" };
        const blocked = fakeRequest({ remoteAddress: local, headers: { host: "panel.lan:80" } });
        await createPanelApiHandler(config)(blocked.req, blocked.res);
        assert.equal(blocked.res.status, 403);
        const allowed = fakeRequest({ remoteAddress: local, headers: { host: "panel.lan:80", "x-zhizhang-token": "test-token" } });
        await createPanelApiHandler(config)(allowed.req, allowed.res);
        assert.notEqual(allowed.res.status, 403);
    }
    finally {
        await server.close();
        await work.cleanup();
    }
});
test("面板限制重复写入请求", async () => {
    const work = await withWork("面板限流");
    try {
        const handler = createPanelApiHandler({ storageRoot: work.base });
        let limited = false;
        for (let i = 0; i < 22; i++) {
            const { req, res } = fakeRequest({ method: "POST", url: "/api/dsh-zhizhang/snapshot" });
            await handler(req, res);
            if (res.status === 429) {
                assert.equal(res.payload.code, "rate_limited");
                limited = true;
                break;
            }
        }
        assert.equal(limited, true);
    }
    finally {
        await work.cleanup();
    }
});

test("面板审读、定稿与版本冲突通过共同章节操作执行", async () => {
    const work = await withWork("面板生命周期"), server = await servePanel({ storageRoot: work.base });
    try {
        await saveChapter(work.dir, { id: "c001", title: "一", body: "她关上门。", status: "drafted" });
        const version = (await readChapter(work.dir, "c001")).revision;
        const request = { work: work.key, chapter: "c001", expectedRevision: version, confirm: true };
        assert.equal((await jpost(server.api, "/chapter/finalize", request)).status, 409);
        assert.equal((await jpost(server.api, "/chapter/review", { ...request, expectedRevision: "stale" })).status, 409);
        assert.equal((await jpost(server.api, "/chapter/review", { ...request, result: "blocked" })).status, 200);
        assert.equal((await jpost(server.api, "/chapter/finalize", request)).status, 409);
        assert.equal((await jpost(server.api, "/chapter/review", request)).status, 200);
        assert.equal((await jpost(server.api, "/chapter/finalize", request)).status, 200);
        assert.equal((await readChapter(work.dir, "c001")).status, "final");
        const bad = await fetch(server.api + "/chapter/review", { method: "POST", headers: { "content-type": "application/json" }, body: "null" });
        assert.equal(bad.status, 400);
    } finally { await server.close(); await work.cleanup(); }
});

test("发行客户端按宿主模块协议加载并安全渲染正文", async () => {
    const { readFile } = await import("node:fs/promises"), { runInNewContext } = await import("node:vm");
    let descriptor;
    runInNewContext(await readFile("dist/client.js", "utf8"), { window: { __ModuleLoader__: { load: value => { descriptor = value; } } } });
    const client = descriptor.factory(() => ({ createElement() {} }));
    assert.equal(typeof client.apply, "function");
    assert.equal(descriptor.id, "dsh-zhizhang");
    const html = client.__testing.lightMdToHtml('<img src=x onerror="alert(1)">\n正文');
    assert.equal(html.includes("<img"), false);
    assert.ok(html.includes("&lt;img"));
});
