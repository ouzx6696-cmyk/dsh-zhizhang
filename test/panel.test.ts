/**
 * Panel HTTP — one server, all routes: health/snapshot/chapter/candidate,
 * accept POST (confirm gate, strict booleans, mode validation),
 * security surface (content-type 415, Origin/Host, LAN allowlist + token,
 * rate limit), unify prepare.
 */
import { describe, test } from "node:test";
import { expect } from "./_compat/expect.ts";
import { EventEmitter } from "node:events";
import { networkInterfaces } from "node:os";
import { stat } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_VERSION } from "./plugin-version.ts";
import { saveChapter, setOutline, stageCandidate, markCandidateLinted, recordBriefBreadcrumb } from "../src/lib/store.ts";
import { jpost, servePanel, withWork } from "./helpers.ts";

function fakePair(opts: { method?: string; url?: string; headers?: Record<string, string>; remoteAddress?: string }) {
  const req = new EventEmitter() as any;
  req.method = opts.method ?? "GET";
  req.url = opts.url ?? "/api/dsh-zhizhang/works";
  req.headers = opts.headers ?? {};
  req.socket = { remoteAddress: opts.remoteAddress ?? "127.0.0.1" };
  const res: any = {
    status: 0,
    payload: "" as any,
    writeHead(status: number) {
      this.status = status;
    },
    end(payload: string) {
      this.payload = JSON.parse(payload);
    },
  };
  return { req, res };
}
function ownLanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (!ni.internal && ni.family === "IPv4" && ni.address)
        return ni.address;
    }
  }
  return "192.168.1.9";
}

describe("panel · 路由与快照", () => {
  test("health 版本与路由面；快照默认无 HTML、字段上界生效、不含正文", async () => {
    const { base, key, dir, cleanup } = await withWork("面板路由");
    await saveChapter(dir, { id: "c001", title: "一", body: "正文。", status: "drafted" });
    await setOutline(dir, "c001", { situationLens: "焦".repeat(900), ending: "他走了。" });
    await stageCandidate(dir, { chapterId: "c001", body: "候选正文。" });
    const { api, close } = await servePanel({ storageRoot: base });
    try {
      const health = await (await fetch(`${api}/health`)).json();
      expect(health.ok).toBe(true);
      expect(health.version).toBe(PLUGIN_VERSION);
      expect(health.acceptViaPost).toBe(true);

      const res = await fetch(`${api}/snapshot?work=${encodeURIComponent(key)}`);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.snapshot.totals.chapters).toBe(1);
      expect(body.snapshot.chapters[0].situationLens.length).toBeLessThanOrEqual(401);
      expect(body.html).toBeUndefined();
      for (const c of body.snapshot.chapters)
        expect(c).not.toHaveProperty("body");
      for (const c of body.snapshot.candidates)
        expect(c).not.toHaveProperty("body");

      const htmlRes = await fetch(`${api}/snapshot?work=${encodeURIComponent(key)}&html=1`);
      expect(((await htmlRes.json()).html ?? "")).toContain("zz-panel");

      const chapter = await (await fetch(`${api}/chapter?work=${encodeURIComponent(key)}&id=c001`)).json();
      expect(chapter.ok).toBe(true);
      expect(chapter.body.length).toBeGreaterThan(0);
      const bad = await fetch(`${api}/candidate?work=${encodeURIComponent(key)}&id=${encodeURIComponent("../x")}`);
      expect(bad.status).toBe(400);
      expect(((await bad.json()).code)).toBe("bad_id");
    }
    finally {
      await close();
      await cleanup();
    }
  });
});

describe("panel · accept POST 语义", () => {
  test("无 confirm 拒 → confirm 过；mode 非法 400；非布尔 confirm 不强转", async () => {
    const { base, dir, key, cleanup } = await withWork("面板采纳");
    await saveChapter(dir, { id: "c001", title: "一", body: "", status: "planned" });
    await setOutline(dir, "c001", { situationLens: "门口", ending: "他推开门。" });
    await recordBriefBreadcrumb(dir, { chapterId: "c001", assetIds: ["draft"] });
    const cand = await stageCandidate(dir, { chapterId: "c001", body: "夜班第七天，他把门推开一条缝。" });
    await markCandidateLinted(dir, cand.id, 0);
    const { api, close } = await servePanel({ storageRoot: base });
    try {
      let res = await jpost(api, "/candidate/accept", { work: key, candidate: cand.id });
      expect(res.status).toBe(400);
      expect(((await res.json()).code)).toBe("confirm_required");

      res = await jpost(api, "/candidate/accept", { work: key, candidate: cand.id, confirm: true, mode: "merge" });
      expect(res.status).toBe(400);
      expect(((await res.json()).code)).toBe("bad_mode");

      res = await jpost(api, "/candidate/accept", { work: key, candidate: cand.id, confirm: 1 });
      expect(res.status).toBe(400);
      expect(((await res.json()).code)).toBe("confirm_required");

      res = await jpost(api, "/candidate/accept", { work: key, candidate: cand.id, confirm: true, mode: "append" });
      expect(res.status).toBe(200);
      expect(((await res.json()).ok)).toBe(true);
    }
    finally {
      await close();
      await cleanup();
    }
  });

  test("unify/prepare：GET 与 POST 都通；POST body base 同权", async () => {
    const { base, cleanup } = await withWork("面板unify");
    const { api, close } = await servePanel({ storageRoot: base });
    try {
      const res = await fetch(`${api}/unify/prepare`);
      const body = await res.json();
      // 未开启多草稿 → 明确拒绝而非 500
      expect([200, 400].includes(res.status)).toBe(true);
      expect(body.ok === false || body.ok === true).toBe(true);
      const post = await jpost(api, "/unify/prepare", {});
      expect([200, 400].includes(post.status)).toBe(true);
    }
    finally {
      await close();
      await cleanup();
    }
  });
});

describe("panel · 安全面", () => {
  test("POST 须 application/json（415）；回环 Origin 不匹配 Host 拒", async () => {
    const { base, cleanup } = await withWork("面板安全");
    const { api, close } = await servePanel({ storageRoot: base });
    try {
      const res = await fetch(`${api}/candidate/accept`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "x",
      });
      expect(res.status).toBe(415);
      expect(((await res.json()).code)).toBe("bad_content_type");

      const evil = await fetch(`${api}/works`, { headers: { origin: "http://evil.example" } });
      expect(evil.status).toBe(403);
      const port = new URL(api).port;
      const same = await fetch(`${api}/works`, { headers: { origin: `http://127.0.0.1:${port}` } });
      expect(same.status).toBe(200);
    }
    finally {
      await close();
      await cleanup();
    }
  });

  test("LAN：默认拒；allowLanPanel+Host 白名单过；panelToken 须匹配", async () => {
    const { base, cleanup } = await withWork("面板局域网");
    try {
      const lan = ownLanAddress();
      const { createPanelApiHandler } = await import("../src/lib/http-api.ts");

      const deny = fakePair({ remoteAddress: lan });
      await createPanelApiHandler({ storageRoot: base })(deny.req, deny.res);
      expect(deny.res.status).toBe(403);

      const ok = fakePair({ remoteAddress: lan, headers: { host: `${lan}:7777` } });
      await createPanelApiHandler({ storageRoot: base, allowLanPanel: true })(ok.req, ok.res);
      expect(ok.res.status).not.toBe(403);

      const wrongHost = fakePair({ remoteAddress: lan, headers: { host: "10.9.9.9:7777" } });
      await createPanelApiHandler({ storageRoot: base, allowLanPanel: true, panelHosts: ["panel.lan"] })(wrongHost.req, wrongHost.res);
      expect(wrongHost.res.status).toBe(403);

      const rightHost = fakePair({ remoteAddress: lan, headers: { host: "panel.lan:80" } });
      await createPanelApiHandler({ storageRoot: base, allowLanPanel: true, panelHosts: ["panel.lan"] })(rightHost.req, rightHost.res);
      expect(rightHost.res.status).not.toBe(403);

      const withToken = { storageRoot: base, allowLanPanel: true, panelToken: "s3cret" } as const;
      const noTok = fakePair({ remoteAddress: lan, headers: { host: `${lan}:7` } });
      await createPanelApiHandler(withToken)(noTok.req, noTok.res);
      expect(noTok.res.status).toBe(403);
      const badTok = fakePair({ remoteAddress: lan, headers: { host: `${lan}:7`, authorization: "Bearer nope" } });
      await createPanelApiHandler(withToken)(badTok.req, badTok.res);
      expect(badTok.res.status).toBe(403);
      const goodTok = fakePair({ remoteAddress: lan, headers: { host: `${lan}:7`, "x-zhizhang-token": "s3cret" } });
      await createPanelApiHandler(withToken)(goodTok.req, goodTok.res);
      expect(goodTok.res.status).not.toBe(403);
    }
    finally {
      await cleanup();
    }
  });

  test("限流：20 POST/分钟后 429", async () => {
    const { base, cleanup } = await withWork("面板限流");
    try {
      const { createPanelApiHandler } = await import("../src/lib/http-api.ts");
      const handler = createPanelApiHandler({ storageRoot: base });
      let saw429 = false;
      let saw405 = 0;
      for (let i = 0; i < 22; i++) {
        const { req, res } = fakePair({ method: "POST", url: "/api/dsh-zhizhang/snapshot" });
        await handler(req, res);
        if (res.status === 429) {
          saw429 = true;
          expect(res.payload.code).toBe("rate_limited");
          break;
        }
        if (res.status === 405)
          saw405 += 1;
      }
      expect(saw429).toBe(true);
      expect(saw405).toBe(20);
    }
    finally {
      await cleanup();
    }
  });
});

describe("panel · 发行产物", () => {
  test("dist/client.js 在位（面板静态资源随包发布）", async () => {
    const p = path.resolve(import.meta.dirname, "../dist/client.js");
    expect((await stat(p)).isFile()).toBe(true);
  });
});
