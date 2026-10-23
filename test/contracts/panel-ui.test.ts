import { PLUGIN_VERSION } from "../plugin-version.ts";
import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Scheduler } from "../../src/lib/ports/index.ts";
import {
  buildPanelSnapshot,
  saveChapter,
  setOutline,
  stageCandidate,
  markCandidateLinted,
  recordBriefBreadcrumb,
} from "../../src/lib/store.ts";
import { createPanelApiHandler, ZZ_API_PREFIX } from "../../src/lib/http-api.ts";
import { withTempWork } from "../helpers.ts";

describe("panel HTML · three-pillar console", () => {
  test("html has overview / library / inspiration / writing sections", async () => {
    const { dir, paths, cleanup } = await withTempWork("面板完整UI");
    try {
      const snap = await buildPanelSnapshot(dir, paths);
      expect(snap.html).toContain('class="zz-panel zhizhang-panel"');
      expect(snap.html).toContain("zz-hero");
      expect(snap.html).toContain("总览");
      expect(snap.html).toContain("Library");
      expect(snap.html).toContain("Inspiration");
      expect(snap.html).toContain("Writing");
      expect(snap.html).toContain("zz-product-loop");
      expect(snap.product.loopLine).toContain(Scheduler.defaultLine().slice(0, 12));
      expect(snap.library).toBeTruthy();
      expect(snap.inspiration).toBeTruthy();
      expect(snap.nextHints.join("\n")).toContain(Scheduler.writeLine());
      expect(snap.nextHints.join("\n")).not.toMatch(/→\s*payoff_audit/);
      expect(snap.html).toContain("二次确认");
    } finally {
      await cleanup();
    }
  });

  test("chapter status dots and situation line appear", async () => {
    const { dir, paths, cleanup } = await withTempWork("状态色点");
    try {
      await saveChapter(dir, {
        id: "c001",
        title: "第一章",
        body: "雨落在檐上。他推开门，灯还亮着。远处有人喊他的名字，他没有回头。".repeat(3),
        status: "drafted",
      });
      await setOutline(dir, "c001", {
        situationLens: "雨夜门口",
        livedScene: "推门见灯",
        stateLens: "未回头",
      });
      const snap = await buildPanelSnapshot(dir, paths);
      expect(snap.html).toContain('data-status="drafted"');
      expect(snap.html).toContain("zz-dot");
      expect(snap.html).toContain("处境：");
      expect(snap.inspiration.outlineProgress.complete).toBe(1);
      expect(snap.title).toBe("状态色点");
    } finally {
      await cleanup();
    }
  });
});

describe("panel HTTP · GET + accept POST", () => {
  test("works / snapshot / library / inspiration roundtrip", async () => {
    const { base, meta, cleanup } = await withTempWork("HTTP面板");
    const handler = createPanelApiHandler({ storageRoot: base });
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const port = addr.port;
    try {
      const worksRes = await fetch(`http://127.0.0.1:${port}${ZZ_API_PREFIX}/works`);
      expect(worksRes.status).toBe(200);
      const works = (await worksRes.json()) as { ok: boolean; works: Array<{ key: string }> };
      expect(works.ok).toBe(true);
      expect(works.works.some((w) => w.key === meta.key)).toBe(true);

      const snapRes = await fetch(
        `http://127.0.0.1:${port}${ZZ_API_PREFIX}/snapshot?work=${encodeURIComponent(meta.key)}`,
      );
      expect(snapRes.status).toBe(200);
      const body = (await snapRes.json()) as {
        ok: boolean;
        snapshot: { workKey: string; nextHints: string[]; library: unknown; product: unknown };
        html?: string;
      };
      expect(body.ok).toBe(true);
      expect(body.snapshot.workKey).toBe(meta.key);
      expect(body.snapshot.library).toBeTruthy();
      expect(body.snapshot.product).toBeTruthy();
      // HTML is opt-in; the default snapshot stays JSON-only for cheap polling.
      expect(body.html).toBeUndefined();
      const htmlRes = await fetch(
        `http://127.0.0.1:${port}${ZZ_API_PREFIX}/snapshot?work=${encodeURIComponent(meta.key)}&html=1`,
      );
      const htmlBody = (await htmlRes.json()) as { html?: string };
      expect(htmlBody.html).toContain("zz-panel");

      const lib = await fetch(`http://127.0.0.1:${port}${ZZ_API_PREFIX}/library`);
      expect(((await lib.json()) as { ok: boolean }).ok).toBe(true);

      const insp = await fetch(
        `http://127.0.0.1:${port}${ZZ_API_PREFIX}/inspiration?work=${encodeURIComponent(meta.key)}`,
      );
      expect(((await insp.json()) as { ok: boolean }).ok).toBe(true);

      const health = await fetch(`http://127.0.0.1:${port}${ZZ_API_PREFIX}/health`);
      const h = (await health.json()) as { ok: boolean; acceptViaPost: boolean };
      expect(h.ok).toBe(true);
      expect(h.acceptViaPost).toBe(true);

      const postSnap = await fetch(`http://127.0.0.1:${port}${ZZ_API_PREFIX}/snapshot`, {
        method: "POST",
      });
      expect(postSnap.status).toBe(405);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      await cleanup();
    }
  });

  test("accept without confirm fails; with confirm + gates can succeed", async () => {
    const { base, dir, meta, cleanup } = await withTempWork("HTTP采纳");
    await saveChapter(dir, {
      id: "c001",
      title: "第一章",
      body: "",
      status: "planned",
    });
    await setOutline(dir, "c001", {
      situationLens: "门口",
      livedScene: "推门",
      stateLens: "犹豫",
      ending: "他推开门。",
    });
    const cand = await stageCandidate(dir, {
      chapterId: "c001",
      body: "雨还在下。他站在门口，手按着门把，听见里面有人走动。灯亮了一下，又暗了。他推开门。".repeat(2),
      note: "panel accept test",
      source: "agent",
    });
    await markCandidateLinted(dir, cand.id, 0);
    await recordBriefBreadcrumb(dir, { chapterId: "c001", assetIds: ["style_contract"] });

    const handler = createPanelApiHandler({ storageRoot: base });
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const port = addr.port;
    try {
      const silent = await fetch(`http://127.0.0.1:${port}${ZZ_API_PREFIX}/candidate/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ work: meta.key, candidate: cand.id }),
      });
      expect(silent.status).toBe(400);
      const silentBody = (await silent.json()) as { ok: boolean; code: string; needConfirm?: boolean };
      expect(silentBody.ok).toBe(false);
      expect(silentBody.code).toBe("confirm_required");
      expect(silentBody.needConfirm).toBe(true);

      const okRes = await fetch(`http://127.0.0.1:${port}${ZZ_API_PREFIX}/candidate/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ work: meta.key, candidate: cand.id, confirm: true }),
      });
      expect(okRes.status).toBe(200);
      const okBody = (await okRes.json()) as { ok: boolean; chapterId: string; wordCount: number };
      expect(okBody.ok).toBe(true);
      expect(okBody.chapterId).toBe("c001");
      expect(okBody.wordCount).toBeGreaterThan(0);

      // second accept without new stage must fail (not silent success)
      const again = await fetch(`http://127.0.0.1:${port}${ZZ_API_PREFIX}/candidate/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ work: meta.key, candidate: cand.id, confirm: true }),
      });
      expect(again.status).toBeGreaterThanOrEqual(400);
      const againBody = (await again.json()) as { ok: boolean };
      expect(againBody.ok).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      await cleanup();
    }
  });

  test("accept without lint is refused (not silent)", async () => {
    const { base, dir, meta, cleanup } = await withTempWork("缺lint拒");
    await saveChapter(dir, { id: "c001", title: "一", body: "", status: "planned" });
    const cand = await stageCandidate(dir, {
      chapterId: "c001",
      body: "短短的一段话凑够字数。门口有人。灯灭了。他又站了一会儿。".repeat(3),
      source: "agent",
    });
    const handler = createPanelApiHandler({ storageRoot: base });
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const port = addr.port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}${ZZ_API_PREFIX}/candidate/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ work: meta.key, candidate: cand.id, confirm: true, skipBrief: true }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      const body = (await res.json()) as { ok: boolean; code: string };
      expect(body.ok).toBe(false);
      expect(body.code).toMatch(/lint/i);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      await cleanup();
    }
  });
});

describe("panel HTTP · chapter + candidate body (0.13)", () => {
  test("GET chapter returns body; bad id 404; traversal rejected; snapshot has no chapter bodies", async () => {
    const { base, dir, meta, cleanup } = await withTempWork("阅读工作台");
    const bodyText =
      "雨落在檐上。他推开门，灯还亮着。\n\n远处有人喊他的名字，他没有回头。".repeat(4);
    await saveChapter(dir, {
      id: "c001",
      title: "第一章",
      body: bodyText,
      status: "drafted",
    });
    const cand = await stageCandidate(dir, {
      chapterId: "c001",
      body: "候选对照正文：门口的灯忽然灭了，他又站了一会儿。".repeat(3),
      note: "workbench",
      source: "agent",
    });

    const handler = createPanelApiHandler({ storageRoot: base });
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const port = addr.port;
    try {
      const ch = await fetch(
        `http://127.0.0.1:${port}${ZZ_API_PREFIX}/chapter?work=${encodeURIComponent(meta.key)}&id=c001`,
      );
      expect(ch.status).toBe(200);
      const chBody = (await ch.json()) as {
        ok: boolean;
        body: string;
        meta: { id: string; title: string };
        truncated: boolean;
      };
      expect(chBody.ok).toBe(true);
      expect(chBody.meta.id).toBe("c001");
      expect(chBody.body).toContain("雨落在檐上");
      expect(chBody.body.length).toBeGreaterThan(20);
      expect(chBody.truncated).toBe(false);

      const missing = await fetch(
        `http://127.0.0.1:${port}${ZZ_API_PREFIX}/chapter?work=${encodeURIComponent(meta.key)}&id=c999`,
      );
      expect(missing.status).toBe(404);

      const trav = await fetch(
        `http://127.0.0.1:${port}${ZZ_API_PREFIX}/chapter?work=${encodeURIComponent(meta.key)}&id=../meta`,
      );
      expect(trav.status).toBe(400);
      const travBody = (await trav.json()) as { ok: boolean; code: string };
      expect(travBody.ok).toBe(false);
      expect(travBody.code).toBe("bad_id");

      const trav2 = await fetch(
        `http://127.0.0.1:${port}${ZZ_API_PREFIX}/chapter?work=${encodeURIComponent(meta.key)}&id=${encodeURIComponent("c001/../../etc")}`,
      );
      expect(trav2.status).toBe(400);

      const candRes = await fetch(
        `http://127.0.0.1:${port}${ZZ_API_PREFIX}/candidate?work=${encodeURIComponent(meta.key)}&id=${encodeURIComponent(cand.id)}`,
      );
      expect(candRes.status).toBe(200);
      const candBody = (await candRes.json()) as { ok: boolean; body: string; meta: { id: string } };
      expect(candBody.ok).toBe(true);
      expect(candBody.body).toContain("候选对照正文");
      expect(candBody.meta.id).toBe(cand.id);

      const snapRes = await fetch(
        `http://127.0.0.1:${port}${ZZ_API_PREFIX}/snapshot?work=${encodeURIComponent(meta.key)}`,
      );
      const snap = (await snapRes.json()) as {
        snapshot: { chapters: Array<Record<string, unknown>>; candidates: Array<Record<string, unknown>> };
      };
      for (const c of snap.snapshot.chapters) {
        expect(c).not.toHaveProperty("body");
      }
      for (const c of snap.snapshot.candidates) {
        expect(c).not.toHaveProperty("body");
      }

      const health = await fetch(`http://127.0.0.1:${port}${ZZ_API_PREFIX}/health`);
      const h = (await health.json()) as { routes: string[]; version: string };
      expect(h.routes.some((r) => r.includes("/chapter"))).toBe(true);
      expect(h.routes.some((r) => r.endsWith("/candidate") || r.includes("/candidate"))).toBe(true);
      expect(h.version).toBe(PLUGIN_VERSION);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      await cleanup();
    }
  });
});

describe("client.js ModuleLoader contract", () => {
  test("full console seats + accept API + no ctx.inject seat wait", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/client/client.js"), "utf8");
    expect(src).toContain("window.__ModuleLoader__.load");
    expect(src).toContain("sidebar.panellist");
    expect(src).toContain('ctx.slots.inject("main"');
    expect(src).toContain("settings.plugin.item");
    expect(src).toContain("specDynamic");
    expect(src).not.toMatch(/ctx\.inject\(\s*\[\s*['"]sidebar/);
    expect(src).toContain('API = "/api/dsh-zhizhang"');
    expect(src).toContain('API + "/snapshot"');
    expect(src).toContain('API + "/candidate/accept"');
    expect(src).toContain("确认采纳");
    expect(src).toContain("POLL_MS");
    expect(src).toContain("Library");
    expect(src).toContain("Inspiration");
  });

  test("0.13 novel workbench markers", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/client/client.js"), "utf8");
    expect(src).toContain("zz-workbench");
    expect(src).toContain("zz-reader");
    expect(src).toContain("zz-wb-left");
    expect(src).toContain("zz-wb-center");
    expect(src).toContain("zz-wb-right");
    expect(src).toContain('"/chapter?"');
    expect(src).toContain('"/candidate?"');
    expect(src).toContain("lightMdToHtml");
    expect(src).toContain("正式章");
    expect(src).toContain("候选对照");
    expect(src).toContain('mode: "novel"');
    expect(src).toContain("LS_CHAPTER");
  });

  test("0.14 multi-draft client markers", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/client/client.js"), "utf8");
    expect(src).toContain("unify/prepare");
    expect(src).toContain("multiDraftEnabled");
    expect(src).toContain("统一整理");
    expect(src).toContain("selectedCandidateId");
    expect(src).toContain("draftLabel");
  });

  test("0.15 unify UI markers", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/client/client.js"), "utf8");
    expect(src).toContain("zz-edit-card");
    expect(src).toContain("编辑抉择");
    expect(src).toContain("zz-empty-card");
    expect(src).toContain("Source Han Serif");
    expect(src).toContain("织章 · 小说工作台");
  });

});
