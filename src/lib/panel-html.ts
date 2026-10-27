import { PLUGIN_VERSION } from "./version.js";
function esc(s: any) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
/** 数字字段强制数值化再插值：磁盘 JSON 被污染成字符串时也不会把标记注进 HTML。 */
function num(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function clip(s: string, n: number) {
    const t = String(s ?? "").trim();
    if (t.length <= n)
        return t;
    return t.slice(0, n) + "…";
}
function statusLabel(status: any) {
    if (status === "final")
        return "定稿";
    if (status === "reviewed")
        return "已审";
    if (status === "planned")
        return "计划";
    return "草稿";
}
const PANEL_CSS = `
.zz-panel{font:14px/1.55 system-ui,-apple-system,sans-serif;color:var(--zz-fg,var(--color-text,#e8eaed));max-width:860px;margin:0 auto;padding:12px 14px 28px;box-sizing:border-box}
.zz-panel *{box-sizing:border-box}
.zz-panel h1{font-size:1.25rem;font-weight:650;margin:0 0 6px;letter-spacing:.02em}
.zz-panel h2{font-size:.72rem;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--zz-muted,var(--color-text-secondary,#9aa0a6));margin:18px 0 8px}
.zz-hero{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;justify-content:space-between;padding:12px 14px;border-radius:12px;background:var(--zz-card,rgba(255,255,255,.04));border:1px solid var(--zz-border,rgba(255,255,255,.08))}
.zz-hero-meta{margin:0;color:var(--zz-muted,#9aa0a6);font-size:.85rem}
.zz-badges{display:flex;flex-wrap:wrap;gap:6px}
.zz-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.zz-badge-ok{background:rgba(52,168,83,.15);border-color:rgba(52,168,83,.35);color:#81c995}
.zz-badge-warn{background:rgba(251,188,5,.12);border-color:rgba(251,188,5,.35);color:#fdd663}
.zz-badge-info{background:rgba(66,133,244,.12);border-color:rgba(66,133,244,.35);color:#8ab4f8}
.zz-card{padding:10px 12px;border-radius:10px;background:var(--zz-card,rgba(255,255,255,.03));border:1px solid var(--zz-border,rgba(255,255,255,.07));margin:0 0 8px}
.zz-card p{margin:0 0 6px}
.zz-muted{color:var(--zz-muted,#9aa0a6);font-size:.82rem}
.zz-loop{padding:10px 12px;border-radius:10px;border-left:3px solid #8ab4f8;background:rgba(66,133,244,.08);font-size:.86rem;margin-bottom:8px}
.zz-pillar-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.zz-foundation{display:grid;gap:6px}
.zz-foundation dt{font-size:.72rem;color:var(--zz-muted,#9aa0a6);margin:0}
.zz-foundation dd{margin:0 0 4px;font-size:.86rem;white-space:pre-wrap;word-break:break-word}
.zz-chapters{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
.zz-chapter{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:start;padding:8px 10px;border-radius:10px;border:1px solid var(--zz-border,rgba(255,255,255,.07));background:rgba(255,255,255,.02)}
.zz-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;background:#9aa0a6}
.zz-dot[data-status=final]{background:#34a853}
.zz-dot[data-status=reviewed]{background:#4285f4}
.zz-dot[data-status=drafted],.zz-dot[data-status=draft]{background:#fbbc05}
.zz-dot[data-status=planned]{background:#9aa0a6}
.zz-ch-title{font-weight:600;font-size:.9rem}
.zz-ch-sub{font-size:.78rem;color:var(--zz-muted,#9aa0a6);margin-top:2px}
.zz-ch-words{font-size:.78rem;color:var(--zz-muted,#9aa0a6);white-space:nowrap}
.zz-hints{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
.zz-hint{padding:8px 10px;border-radius:8px;border-left:3px solid #8ab4f8;background:rgba(66,133,244,.08);font-size:.86rem}
.zz-hint-urgent{border-left-color:#fbbc05;background:rgba(251,188,5,.1)}
.zz-cand{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
.zz-cand li{padding:8px 10px;border-radius:8px;border:1px dashed rgba(251,188,5,.4);background:rgba(251,188,5,.06);font-size:.86rem}
.zz-empty{color:var(--zz-muted,#9aa0a6);font-size:.86rem;margin:0;padding:6px 0}
.zz-fold{margin-top:4px}
.zz-fold summary{cursor:pointer;color:var(--zz-muted,#9aa0a6);font-size:.8rem;user-select:none}
.zz-fold ul{margin:6px 0 0;padding-left:1.1rem;font-size:.8rem;color:var(--zz-muted,#9aa0a6)}
.zz-foot{margin-top:16px;font-size:.72rem;color:var(--zz-muted,#9aa0a6)}
.zz-note{font-size:.78rem;color:var(--zz-muted,#9aa0a6);margin:4px 0 0}
@media (max-width:480px){.zz-panel{padding:10px}.zz-hero{padding:10px}.zz-chapter{grid-template-columns:8px 1fr}.zz-pillar-grid{grid-template-columns:1fr}}
`.trim();
export function renderPanelHtml(input: any) {
    const pending = input.candidates.filter((c: any) => c.pending);
    const { totals, foundation } = input;
    const product = input.product;
    const library = input.library;
    const inspiration = input.inspiration;
    const badges = [
        `<span class="zz-badge zz-badge-info">${num(totals.chapters)} 章</span>`,
        `<span class="zz-badge">${num(totals.words).toLocaleString("zh-CN")} 字</span>`,
        `<span class="zz-badge zz-badge-ok">定稿 ${num(totals.final)}</span>`,
        `<span class="zz-badge">草稿 ${num(totals.drafted)}</span>`,
        `<span class="zz-badge">计划 ${num(totals.planned)}</span>`,
        pending.length > 0
            ? `<span class="zz-badge zz-badge-warn">待采纳 ${num(pending.length)}</span>`
            : `<span class="zz-badge">待采纳 0</span>`,
        library
            ? (library.unavailable ? `<span class="zz-badge zz-badge-warn">拆书库暂不可读</span>` : `<span class="zz-badge zz-badge-info">craft ${num(library.craftCount)} · mind ${num(library.mindCount)}</span>`)
            : "",
    ]
        .filter(Boolean)
        .join("");
    const loopHtml = product
        ? `<div class="zz-loop zz-product-loop">${esc(product.loopLine)}</div>
       <p class="zz-muted">默认写作：${esc(product.writeLine)}</p>`
        : "";
    const pillarsHtml = product
        ? `<div class="zz-pillar-grid">` +
            product.pillars
                .map((p: any) => `<div class="zz-card" data-pillar="${esc(p.id)}"><div class="zz-ch-title">${p.loopStage}. ${esc(p.title)}</div>` +
                `<div class="zz-ch-sub">${esc(clip(p.summary, 120))}</div>` +
                `<div class="zz-note">交接：${esc(clip(p.handsOffTo, 80))}</div></div>`)
                .join("") +
            `</div>`
        : "";
    const libraryHtml = !library
        ? `<p class="zz-empty">无拆书库摘要</p>`
        : library.unavailable
        ? `<p class="zz-err" role="alert">${esc(library.summary || "拆书库暂不可读")}</p>`
        : `<div class="zz-card zz-library">
  <div class="zz-badges">
    <span class="zz-badge">来源 ${num(library.sourcesCount)}</span>
    <span class="zz-badge zz-badge-ok">已采纳 ${num(library.acceptedCount)}</span>
    <span class="zz-badge">草稿卡 ${num(library.draftedCount)}</span>
    <span class="zz-badge zz-badge-info">craft ${num(library.craftCount)}</span>
    <span class="zz-badge zz-badge-info">mind ${num(library.mindCount)}</span>
  </div>
  <p class="zz-muted" style="margin-top:8px">${esc(clip(library.summary, 160))}</p>
  ${library.sources.length
            ? `<ul class="zz-muted">` +
                library.sources
                    .slice(0, 6)
                    .map((s: any) => `<li>${esc(s.title)}${s.author ? " · " + esc(s.author) : ""} <code>${esc(s.id)}</code></li>`)
                    .join("") +
                `</ul>`
            : `<p class="zz-empty">暂无来源。可用 zhizhang_library_import</p>`}
  ${library.combo
            ? library.combo.ok
                ? `<p class="zz-note">最近 combo 建议：mind「${esc(library.combo.mindTitle || "—")}」+ craft ${esc(library.combo.craftTitles.join("、") || "—")}</p>`
                : `<p class="zz-note">combo：${esc(library.combo.emptyReason || "暂无")}</p>`
            : ""}
</div>`;
    const op = inspiration?.outlineProgress;
    const inspirationHtml = !inspiration
        ? `<p class="zz-empty">无灵感摘要</p>`
        : `<div class="zz-card zz-inspiration">
  <div class="zz-badges">
    <span class="zz-badge">会话 ${num(inspiration.sessionsCount)}</span>
    <span class="zz-badge zz-badge-warn">待 emit ${num(inspiration.pendingEmits)}</span>
    <span class="zz-badge ${inspiration.appliedToWork ? "zz-badge-ok" : ""}">${inspiration.appliedToWork ? "已 apply 到本作品" : "未 apply"}</span>
    <span class="zz-badge ${inspiration.foundationFilled ? "zz-badge-ok" : ""}">根基字段 ${num(inspiration.foundationFilledFields.length)}</span>
  </div>
  <p class="zz-muted" style="margin-top:8px">三纲进度：处境 ${num(op?.withSituation)}/${num(op?.total)} · 场面 ${num(op?.withLived)} · 状态 ${num(op?.withState)} · 齐备 ${num(op?.complete)}</p>
  ${inspiration.sessions.length
            ? `<ul class="zz-muted">` +
                inspiration.sessions
                    .slice(0, 4)
                    .map((s: any) => `<li>${esc(clip(s.goal, 48))} · ${num(s.cardCount)} 卡 <code>${esc(s.id)}</code></li>`)
                    .join("") +
                `</ul>`
            : `<p class="zz-empty">暂无灵感会话</p>`}
</div>`;
    const chaptersHtml = input.chapters.length === 0
        ? `<p class="zz-empty">暂无章节</p>`
        : `<ol class="zz-chapters">` +
            input.chapters
                .map((c: any) => {
                const sit = clip(c.situationLens, 72);
                return (`<li class="zz-chapter" data-id="${esc(c.id)}" data-status="${esc(c.status)}">` +
                    `<span class="zz-dot" data-status="${esc(c.status)}" title="${esc(statusLabel(c.status))}"></span>` +
                    `<div><div class="zz-ch-title">${esc(c.title)}` +
                    (c.briefRecent ? ` <span class="zz-badge zz-badge-ok">brief✓</span>` : "") +
                    `</div>` +
                    `<div class="zz-ch-sub">${esc(statusLabel(c.status))}` +
                    (sit ? ` · 处境：${esc(sit)}` : "") +
                    `</div></div>` +
                    `<div class="zz-ch-words">${num(c.wordCount)} 字</div>` +
                    `</li>`);
            })
                .join("") +
            `</ol>`;
    const candHtml = pending.length === 0
        ? `<p class="zz-empty">无待采纳。Web 面板可点「采纳」（须二次确认 + 同硬闸）；或用工具 zhizhang_candidate_accept。</p>`
        : `<ul class="zz-cand">` +
            pending
                .map((c: any) => {
                const label = c.draftLabel ? `「${c.draftLabel}」 ` : "";
                const flags = [
                    c.hasLintPass ? "lint✓" : "缺 lint",
                    c.editOf ? `编辑自 ${c.editOf}` : "",
                    c.unifyOf?.length ? `整理自 ${c.unifyOf.length} 稿` : "",
                    c.source === "unify" ? "source=unify" : "",
                    c.lintHitCount ? `hits ${c.lintHitCount}` : "",
                ]
                    .filter(Boolean)
                    .join(" · ");
                return (`<li data-cand="${esc(c.id)}"><strong>${esc(label)}${esc(c.id)}</strong> → ${esc(c.chapterId)} · ${num(c.wordCount)} 字` +
                    (c.note ? `<div class="zz-muted">${esc(clip(c.note, 80))}</div>` : "") +
                    `<div class="zz-muted">${esc(flags)} · 面板采纳须二次确认（同 Accept 硬闸）</div></li>`);
            })
                .join("") +
            `</ul>`;
    const hintsHtml = input.nextHints.length === 0
        ? `<p class="zz-empty">暂无提示</p>`
        : `<ul class="zz-hints">` +
            input.nextHints
                .map((h: any, i: number) => {
                const urgent = i < 2 && (h.includes("待采纳") || h.includes("硬拒") || h.includes("缺"));
                return `<li class="zz-hint${urgent ? " zz-hint-urgent" : ""}">${esc(h)}</li>`;
            })
                .join("") +
            `</ul>`;
    const foundationHtml = `
<dl class="zz-foundation zz-card">
  <dt>锁（locks）</dt><dd>${esc(clip(foundation.locks, 200)) || "—"}</dd>
  <dt>已发生（happened）</dt><dd>${esc(clip(foundation.happened, 240)) || "—"}</dd>
  <dt>线头（threads）</dt><dd>${esc(clip(foundation.threads, 160)) || "—"}</dd>
  <dt>调性（style）</dt><dd>${esc(clip(foundation.style, 120)) || "—"}</dd>
</dl>`.trim();
    const ledgerItems = input.ledgerRecent.slice(-8).reverse();
    const ledgerHtml = ledgerItems.length === 0
        ? `<p class="zz-empty">无</p>`
        : `<ul>` +
            ledgerItems
                .map((e: any) => `<li>[${esc(e.at)}] ${esc(e.kind)} · ${esc(e.chapterId)} · ${esc(clip(e.summary, 72))}</li>`)
                .join("") +
            `</ul>`;
    const briefItems = input.briefCrumbsRecent.slice(-8).reverse();
    const briefHtml = briefItems.length === 0
        ? `<p class="zz-empty">无</p>`
        : `<ul>` +
            briefItems
                .map((e: any) => `<li>${esc(e.chapterId)} @ ${esc(e.at)} · ${esc((e.assetIds ?? []).join(",") || "—")}</li>`)
                .join("") +
            `</ul>`;
    const payoffEntries = Object.values(input.lastPayoffByChapter);
    const payoffHtml = payoffEntries.length === 0
        ? `<p class="zz-empty">无（例行三 audit 不在默认创作路径）</p>`
        : `<ul>` +
            payoffEntries
                .map((e: any) => `<li>${esc(e.chapterId)} · ${e.ok ? "ok" : "warn:" + num(e.warningCount)} · ${esc(clip(e.summary, 72))}</li>`)
                .join("") +
            `</ul>`;
    return [
        `<article class="zz-panel zhizhang-panel" data-work="${esc(input.workKey)}">`,
        `<style>${PANEL_CSS}</style>`,
        `<div class="zz-hero">`,
        `<div><h1>${esc(input.title)}</h1>`,
        `<p class="zz-hero-meta">key=${esc(input.workKey)}${input.genre ? ` · ${esc(input.genre)}` : ""}</p></div>`,
        `<div class="zz-badges">${badges}</div>`,
        `</div>`,
        `<p class="zz-card zz-muted" style="margin-top:10px">Web 侧栏默认「小说」三栏阅读；本 HTML 为管线信息架构快照（与工具/HTTP 同源）。</p>`,
        `<h2>总览 · 创作闭环</h2>`,
        loopHtml,
        pillarsHtml,
        `<h2>下一步</h2>`,
        hintsHtml,
        `<h2>Library · 拆书库</h2>`,
        libraryHtml,
        `<h2>Inspiration · 灵感</h2>`,
        inspirationHtml,
        `<h2>Writing · 当前小说状态</h2>`,
        `<p class="zz-muted">低权重摘要（非账本）</p>`,
        foundationHtml,
        `<h2>Writing · 章节</h2>`,
        chaptersHtml,
        `<h2>Writing · 待采纳</h2>`,
        candHtml,
        `<p class="zz-note">编辑抉择：A 确认=编辑+验收 · B 仅候选再验 · C 拒/换模式（工具 edit_decide）；面板只做正式采纳。可选多草稿默认关。</p>`,
        `<h2>工程留痕</h2>`,
        `<details class="zz-fold"><summary>审校留痕（最近）</summary>${ledgerHtml}</details>`,
        `<details class="zz-fold"><summary>brief 留痕（近期）</summary>${briefHtml}</details>`,
        `<details class="zz-fold"><summary>兑付摘要（可选）</summary>${payoffHtml}</details>`,
        `<p class="zz-foot">织章 ${PLUGIN_VERSION} · 小说工作台/管线同源 · 写回经显式采纳 · nextHints≡Scheduler · multi.draft 旁路默认关 · 不进默认链 payoff_audit</p>`,
        `</article>`,
    ].join("\n");
}
