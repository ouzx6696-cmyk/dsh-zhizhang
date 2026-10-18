/**
 * dsh-zhizhang — browser half (full Web console).
 *
 * Seats: sidebar.panellist + main + settings.plugin.item (optional).
 * Data: GET snapshot / chapter / candidate; POST candidate/accept (same Accept hard gates).
 * Default UI: novel workbench (三栏阅读); pipeline tabs secondary.
 * Format: window.__ModuleLoader__.load({ id, factory }) for DSH Web.
 */
window.__ModuleLoader__.load({
  id: "dsh-zhizhang",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useCallback = react.useCallback;
    var useRef = react.useRef;

    var PANEL_ID = "dsh-zhizhang";
    var PANEL_ORDER = 28;
    var SETTINGS_KEY = "dsh-zhizhang-config";
    var API = "/api/dsh-zhizhang";
    var LS_WORK = "dsh-zhizhang:lastWork";
    var LS_CHAPTER = "dsh-zhizhang:lastChapter";
    var LS_MODE = "dsh-zhizhang:uiMode";
    var POLL_MS = 6000;
    var POLL_HIDDEN_MS = 30000;

    var STYLE_ID = "zz-panel-css";
    var CSS = [
      ".zz-root{height:100%;overflow:auto;padding:16px 18px 36px;box-sizing:border-box;",
      "font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;",
      "color:var(--color-text,var(--ds-fg,#e8eaed));background:transparent;",
      "-webkit-font-smoothing:antialiased}",
      ".zz-root *{box-sizing:border-box}",
      ".zz-top{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;justify-content:space-between;margin-bottom:14px}",
      ".zz-title{font-size:1.28rem;font-weight:700;margin:0;letter-spacing:.01em}",
      ".zz-sub{margin:6px 0 0;font-size:.78rem;line-height:1.45;color:var(--color-text-secondary,#9aa0a6);max-width:42rem}",
      ".zz-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      ".zz-btn{appearance:none;border:1px solid rgba(127,127,127,.32);background:rgba(127,127,127,.07);",
      "color:inherit;border-radius:9px;padding:6px 12px;font-size:.8rem;cursor:pointer;transition:background .12s,border-color .12s}",
      ".zz-btn:hover{background:rgba(127,127,127,.14)}",
      ".zz-btn:disabled{opacity:.45;cursor:default}",
      ".zz-btn-primary{background:rgba(66,133,244,.2);border-color:rgba(66,133,244,.42)}",
      ".zz-btn-primary:hover{background:rgba(66,133,244,.3)}",
      ".zz-btn-danger{background:rgba(234,67,53,.14);border-color:rgba(234,67,53,.38)}",
      ".zz-select{border-radius:9px;border:1px solid rgba(127,127,127,.32);background:rgba(0,0,0,.12);",
      "color:inherit;padding:5px 10px;font-size:.8rem;max-width:220px}",
      ".zz-badges{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 14px}",
      ".zz-badge{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font-size:.7rem;",
      "font-weight:650;letter-spacing:.02em;background:rgba(127,127,127,.09);border:1px solid rgba(127,127,127,.18);",
      "color:var(--color-text-secondary,#9aa0a6)}",
      ".zz-badge-ok{background:rgba(52,168,83,.14);border-color:rgba(52,168,83,.32);color:#81c995}",
      ".zz-badge-warn{background:rgba(251,188,5,.11);border-color:rgba(251,188,5,.32);color:#fdd663}",
      ".zz-badge-info{background:rgba(66,133,244,.11);border-color:rgba(66,133,244,.32);color:#8ab4f8}",
      ".zz-tabs{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 14px;border-bottom:1px solid rgba(127,127,127,.18);padding-bottom:8px}",
      ".zz-tab{appearance:none;border:none;background:transparent;color:var(--color-text-secondary,#9aa0a6);",
      "padding:7px 12px;border-radius:9px 9px 0 0;font-size:.82rem;cursor:pointer;font-weight:600}",
      ".zz-tab:hover{background:rgba(127,127,127,.08);color:inherit}",
      ".zz-tab-on{background:rgba(66,133,244,.12);color:inherit;box-shadow:inset 0 -2px 0 #8ab4f8}",
      ".zz-sec{margin:16px 0 8px;font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;",
      "color:var(--color-text-secondary,#9aa0a6)}",
      ".zz-card{padding:12px 14px;border-radius:12px;border:1px solid rgba(127,127,127,.2);",
      "background:rgba(127,127,127,.045);margin-bottom:10px}",
      ".zz-muted{color:var(--color-text-secondary,#9aa0a6);font-size:.82rem;line-height:1.45}",
      ".zz-loop{padding:12px 14px;border-radius:12px;border-left:3px solid #8ab4f8;",
      "background:rgba(66,133,244,.07);margin-bottom:10px;font-size:.86rem;line-height:1.5}",
      ".zz-hint{padding:9px 12px;border-radius:10px;border-left:3px solid #8ab4f8;",
      "background:rgba(66,133,244,.07);margin-bottom:7px;font-size:.84rem;line-height:1.45}",
      ".zz-hint-urgent{border-left-color:#fbbc05;background:rgba(251,188,5,.09)}",
      ".zz-ch{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:start;",
      "padding:9px 11px;border-radius:11px;border:1px solid rgba(127,127,127,.18);",
      "background:rgba(127,127,127,.035);margin-bottom:7px}",
      ".zz-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;background:#9aa0a6}",
      ".zz-dot-final{background:#34a853}",
      ".zz-dot-reviewed{background:#4285f4}",
      ".zz-dot-drafted,.zz-dot-draft{background:#fbbc05}",
      ".zz-dot-planned{background:#9aa0a6}",
      ".zz-ch-title{font-weight:650;font-size:.9rem}",
      ".zz-ch-sub{font-size:.76rem;color:var(--color-text-secondary,#9aa0a6);margin-top:3px}",
      ".zz-cand{padding:12px 14px;border-radius:12px;border:1px dashed rgba(251,188,5,.4);",
      "background:rgba(251,188,5,.055);margin-bottom:10px;font-size:.86rem}",
      ".zz-cand-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center}",
      ".zz-empty{color:var(--color-text-secondary,#9aa0a6);font-size:.88rem;padding:18px 8px;text-align:center;line-height:1.55}",
      ".zz-empty-card{border:1px dashed rgba(127,127,127,.28);border-radius:12px;background:rgba(127,127,127,.03);margin:8px 0}",
      ".zz-err{padding:11px 13px;border-radius:11px;background:rgba(234,67,53,.11);",
      "border:1px solid rgba(234,67,53,.32);color:#f28b82;margin-bottom:12px;font-size:.86rem;white-space:pre-wrap}",
      ".zz-ok{padding:11px 13px;border-radius:11px;background:rgba(52,168,83,.11);",
      "border:1px solid rgba(52,168,83,.32);color:#81c995;margin-bottom:12px;font-size:.86rem;white-space:pre-wrap}",
      ".zz-banner{padding:10px 12px;border-radius:10px;background:rgba(66,133,244,.08);",
      "border:1px solid rgba(66,133,244,.22);margin-bottom:14px;font-size:.82rem;line-height:1.45}",
      ".zz-fold{margin-top:8px}",
      ".zz-fold summary{cursor:pointer;color:var(--color-text-secondary,#9aa0a6);font-size:.8rem}",
      ".zz-fold ul{margin:6px 0 0;padding-left:1.1rem;font-size:.8rem;color:var(--color-text-secondary,#9aa0a6)}",
      ".zz-foot{margin-top:20px;font-size:.7rem;color:var(--color-text-secondary,#9aa0a6)}",
      ".zz-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}",
      ".zz-poll{font-size:.72rem;color:var(--color-text-secondary,#9aa0a6)}",
      ".zz-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;",
      "justify-content:center;z-index:9999;padding:16px;backdrop-filter:blur(2px)}",
      ".zz-modal{max-width:440px;width:100%;border-radius:14px;padding:18px;background:var(--color-bg,var(--ds-bg,#202124));",
      "border:1px solid rgba(127,127,127,.32);box-shadow:0 16px 48px rgba(0,0,0,.4);color:inherit}",
      ".zz-modal h3{margin:0 0 8px;font-size:1.05rem}",
      ".zz-check{display:flex;gap:8px;align-items:flex-start;font-size:.86rem;margin:10px 0}",
      ".zz-settings{padding:14px;border-radius:12px;border:1px solid rgba(127,127,127,.22);background:rgba(127,127,127,.04)}",
      ".zz-mode{display:inline-flex;border:1px solid rgba(127,127,127,.3);border-radius:10px;overflow:hidden;",
      "background:rgba(127,127,127,.05);padding:2px;gap:2px}",
      ".zz-mode button{appearance:none;border:none;background:transparent;color:var(--color-text-secondary,#9aa0a6);",
      "padding:6px 14px;font-size:.8rem;cursor:pointer;font-weight:650;border-radius:8px;transition:background .12s,color .12s}",
      ".zz-mode button.zz-mode-on{background:rgba(66,133,244,.22);color:inherit;box-shadow:0 1px 2px rgba(0,0,0,.12)}",
      ".zz-workbench{display:grid;grid-template-columns:232px minmax(0,1fr) 292px;gap:14px;",
      "min-height:min(72vh,760px);align-items:stretch}",
      ".zz-wb-col{border:1px solid rgba(127,127,127,.2);border-radius:14px;",
      "background:linear-gradient(180deg,rgba(127,127,127,.055),rgba(127,127,127,.025));",
      "display:flex;flex-direction:column;min-height:0;overflow:hidden;box-shadow:0 1px 0 rgba(255,255,255,.03) inset}",
      ".zz-wb-head{padding:10px 12px;font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;",
      "color:var(--color-text-secondary,#9aa0a6);border-bottom:1px solid rgba(127,127,127,.16);flex:0 0 auto;",
      "background:rgba(127,127,127,.04)}",
      ".zz-wb-body{padding:10px;overflow:auto;flex:1 1 auto}",
      ".zz-wb-center .zz-wb-body{padding:12px 16px 28px}",
      ".zz-ch-item{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:start;",
      "padding:9px 9px;border-radius:10px;cursor:pointer;border:1px solid transparent;margin-bottom:5px;",
      "transition:background .1s,border-color .1s}",
      ".zz-ch-item:hover{background:rgba(127,127,127,.08)}",
      ".zz-ch-item.zz-ch-on{background:rgba(66,133,244,.12);border-color:rgba(66,133,244,.32)}",
      ".zz-cand-mini{margin:0 0 5px 18px;padding:7px 9px;border-radius:9px;border:1px dashed rgba(251,188,5,.38);",
      "background:rgba(251,188,5,.055);font-size:.76rem;cursor:pointer;transition:background .1s}",
      ".zz-cand-mini.zz-ch-on{border-style:solid;background:rgba(251,188,5,.13)}",
      ".zz-reader-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px;",
      "padding-bottom:10px;border-bottom:1px solid rgba(127,127,127,.12)}",
      ".zz-reader{padding:2px 4px 32px;font-size:1.02rem;line-height:1.85;max-width:40rem;",
      "font-family:\"Source Han Serif SC\",\"Noto Serif SC\",\"Songti SC\",Georgia,\"Times New Roman\",serif;",
      "letter-spacing:.01em}",
      ".zz-reader h1,.zz-reader h2,.zz-reader h3{font-weight:700;margin:1.25em 0 .55em;line-height:1.35;",
      "font-family:system-ui,-apple-system,sans-serif}",
      ".zz-reader h1{font-size:1.35rem}.zz-reader h2{font-size:1.15rem}.zz-reader h3{font-size:1.02rem}",
      ".zz-reader p{margin:0 0 1em}",
      ".zz-reader strong{font-weight:700}",
      ".zz-reader em{font-style:italic}",
      ".zz-reader code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.84em;",
      "padding:1px 5px;border-radius:5px;background:rgba(127,127,127,.12)}",
      ".zz-reader pre{padding:12px;border-radius:10px;overflow:auto;background:rgba(127,127,127,.1);font-size:.82rem}",
      ".zz-reader blockquote{margin:0 0 1em;padding:6px 0 6px 14px;border-left:3px solid rgba(66,133,244,.4);",
      "color:var(--color-text-secondary,#9aa0a6)}",
      ".zz-reader hr{border:none;border-top:1px solid rgba(127,127,127,.22);margin:1.4em 0}",
      ".zz-gate{font-size:.82rem;margin-bottom:7px;line-height:1.4}",
      ".zz-gate-ok{color:#81c995}.zz-gate-bad{color:#f28b82}",
      ".zz-edit-card{padding:12px 14px;border-radius:12px;border:1px solid rgba(66,133,244,.28);",
      "background:rgba(66,133,244,.07);margin-bottom:10px;font-size:.82rem;line-height:1.5}",
      ".zz-edit-card strong{display:block;margin-bottom:6px;font-size:.78rem;letter-spacing:.04em}",
      ".zz-edit-card ol{margin:6px 0 0;padding-left:1.15rem}",
      ".zz-edit-card li{margin-bottom:4px}",
      "@media (max-width:1100px){.zz-workbench{grid-template-columns:180px minmax(0,1fr);}",
      ".zz-wb-right{grid-column:1 / -1;max-height:300px}}",
      "@media (max-width:720px){.zz-workbench{grid-template-columns:1fr}.zz-wb-left{max-height:220px}}",
      "@media (max-width:520px){.zz-root{padding:12px}.zz-ch{grid-template-columns:8px 1fr}.zz-grid{grid-template-columns:1fr}}",
      "@media (prefers-color-scheme:light){",
      ".zz-root{color:#202124}",
      ".zz-badge{color:#5f6368}",
      ".zz-badge-ok{color:#137333}.zz-badge-warn{color:#b06000}.zz-badge-info{color:#1a73e8}",
      ".zz-err{color:#c5221f}.zz-ok{color:#137333}",
      ".zz-gate-ok{color:#137333}.zz-gate-bad{color:#c5221f}",
      ".zz-wb-col{background:linear-gradient(180deg,rgba(0,0,0,.02),rgba(0,0,0,.01))}",
      ".zz-mode button.zz-mode-on{background:rgba(26,115,232,.14)}",
      "}",
        ].join("");

    function ensureCss() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID)) return;
      var el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = CSS;
      document.head.appendChild(el);
    }

    function clip(s, n) {
      var t = String(s == null ? "" : s).trim();
      if (t.length <= n) return t;
      return t.slice(0, n) + "…";
    }

    function statusLabel(status) {
      if (status === "final") return "定稿";
      if (status === "reviewed") return "已审";
      if (status === "planned") return "计划";
      return "草稿";
    }

    function escapeHtml(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    /** Extremely light Markdown → HTML (no Tiptap). */
    function lightMdToHtml(md) {
      var text = String(md == null ? "" : md).replace(/\r\n/g, "\n");
      if (!text.trim()) return "";
      var lines = text.split("\n");
      var html = [];
      var inCode = false;
      var para = [];
      function flushPara() {
        if (!para.length) return;
        var joined = para.join("\n");
        para = [];
        var esc = escapeHtml(joined);
        esc = esc.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        esc = esc.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
        esc = esc.replace(/`([^`]+)`/g, "<code>$1</code>");
        esc = esc.replace(/\n/g, "<br/>");
        html.push("<p>" + esc + "</p>");
      }
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf("```") === 0) {
          flushPara();
          if (inCode) {
            html.push("</code></pre>");
            inCode = false;
          } else {
            html.push("<pre><code>");
            inCode = true;
          }
          continue;
        }
        if (inCode) {
          html.push(escapeHtml(line) + "\n");
          continue;
        }
        if (/^\s*$/.test(line)) {
          flushPara();
          continue;
        }
        if (/^---+$/.test(line.trim())) {
          flushPara();
          html.push("<hr/>");
          continue;
        }
        var hm = /^(#{1,3})\s+(.+)$/.exec(line);
        if (hm) {
          flushPara();
          var lvl = hm[1].length;
          html.push("<h" + lvl + ">" + escapeHtml(hm[2]) + "</h" + lvl + ">");
          continue;
        }
        if (/^>\s?/.test(line)) {
          flushPara();
          html.push("<blockquote><p>" + escapeHtml(line.replace(/^>\s?/, "")) + "</p></blockquote>");
          continue;
        }
        para.push(line);
      }
      flushPara();
      if (inCode) html.push("</code></pre>");
      return html.join("");
    }

    function fetchJson(url, opts) {
      opts = opts || {};
      var ms = opts.timeoutMs || 10000;
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = null;
      if (ctrl && ms) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms);
      var init = {
        method: opts.method || "GET",
        headers: Object.assign({ accept: "application/json" }, opts.headers || {}),
        signal: ctrl ? ctrl.signal : undefined,
        body: opts.body,
      };
      return fetch(url, init)
        .then(function (r) {
          if (timer) clearTimeout(timer);
          return r.json().then(function (data) {
            return { status: r.status, ok: r.ok, data: data };
          }).catch(function () {
            throw new Error("HTTP " + r.status + " (non-JSON)");
          });
        })
        .catch(function (err) {
          if (timer) clearTimeout(timer);
          throw err;
        });
    }

    function slotDeclared(ctx, name) {
      try {
        var slots = ctx && ctx.slots;
        if (!slots) return false;
        if (typeof slots.specDynamic === "function") return !!slots.specDynamic(name);
        if (typeof slots.spec === "function") return !!slots.spec(name);
      } catch (e) {}
      return false;
    }

    function SidebarIcon(props) {
      var size = typeof props.size === "number" && props.size > 0 ? props.size : 16;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("path", { d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20" }),
        h("path", { d: "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" }),
        h("path", { d: "M8 7h8M8 11h6" }),
      );
    }

    function Badge(props) {
      return h("span", { className: "zz-badge " + (props.tone || "") }, props.children);
    }

    function AcceptDialog(props) {
      var cand = props.cand;
      var st = useState({ checked: false, force: false, skipBrief: false, busy: false, err: null });
      var state = st[0];
      var setState = st[1];
      if (!cand) return null;
      var isEdit = !!cand.editOf;
      return h(
        "div",
        { className: "zz-modal-bg", role: "dialog", "aria-modal": "true", onClick: function (e) {
          if (e.target === e.currentTarget && !state.busy) props.onCancel();
        } },
        h(
          "div",
          { className: "zz-modal" },
          h("h3", null, "确认采纳候选"),
          h(
            "p",
            { className: "zz-muted" },
            cand.id + " → " + cand.chapterId + " · " + cand.wordCount + " 字",
            isEdit ? "（编辑稿，路径 A：采纳并验收）" : "",
          ),
          !cand.hasLintPass
            ? h("div", { className: "zz-err" }, "尚未 lint：采纳将被硬拒。请先让 Agent 跑 zhizhang_style_lint。")
            : null,
          h(
            "label",
            { className: "zz-check" },
            h("input", {
              type: "checkbox",
              checked: state.checked,
              disabled: state.busy,
              onChange: function (e) {
                setState(Object.assign({}, state, { checked: e.target.checked }));
              },
            }),
            h(
              "span",
              null,
              isEdit
                ? "我确认：采纳本章编辑稿并验收为正式章（等同 confirm + confirm_accept_after_edit）"
                : "我确认采纳本候选到章节草稿（须过 Accept 硬闸；禁止静默成功）",
            ),
          ),
          h(
            "label",
            { className: "zz-check" },
            h("input", {
              type: "checkbox",
              checked: state.force,
              disabled: state.busy,
              onChange: function (e) {
                setState(Object.assign({}, state, { force: e.target.checked }));
              },
            }),
            h("span", null, "force：目标章若为 final 则强制覆盖（降为 drafted）"),
          ),
          h(
            "label",
            { className: "zz-check" },
            h("input", {
              type: "checkbox",
              checked: state.skipBrief,
              disabled: state.busy,
              onChange: function (e) {
                setState(Object.assign({}, state, { skipBrief: e.target.checked }));
              },
            }),
            h("span", null, "skip_brief：跳过近期 chapter_brief 硬闸（作者旁路）"),
          ),
          state.err ? h("div", { className: "zz-err" }, state.err) : null,
          h(
            "div",
            { className: "zz-cand-actions" },
            h(
              "button",
              {
                type: "button",
                className: "zz-btn zz-btn-primary",
                disabled: !state.checked || state.busy,
                onClick: function () {
                  setState(Object.assign({}, state, { busy: true, err: null }));
                  props
                    .onConfirm({
                      confirm: true,
                      force: state.force,
                      skipBrief: state.skipBrief,
                      acceptAfterEdit: isEdit,
                      confirmAcceptAfterEdit: isEdit,
                    })
                    .catch(function (err) {
                      setState(function (s) {
                        return Object.assign({}, s, {
                          busy: false,
                          err: (err && err.message) || String(err),
                        });
                      });
                    });
                },
              },
              state.busy ? "采纳中…" : "确认采纳",
            ),
            h(
              "button",
              {
                type: "button",
                className: "zz-btn",
                disabled: state.busy,
                onClick: props.onCancel,
              },
              "取消",
            ),
          ),
          h(
            "p",
            { className: "zz-muted", style: { marginTop: 10 } },
            "编辑抉择 A/B/C 请用工具 zhizhang_candidate_edit_decide；面板只做正式采纳。",
          ),
        ),
      );
    }

    function SettingsCard() {
      ensureCss();
      return h(
        "div",
        { className: "zz-settings" },
        h("div", { className: "zz-ch-title" }, "织章"),
        h(
          "p",
          { className: "zz-muted" },
          "小说工作台：打开就能读正文、对照候选、真采纳。侧栏点「织章」。管线五区可切换查看。",
        ),
        h(
          "p",
          { className: "zz-muted" },
          "存储：项目下 .zhizhang/，或插件 config.storageRoot / 环境变量 DSH_ZHIZHANG_ROOT。HTTP 根不跟每个会话 cwd 时请配 storageRoot。",
        ),
        h(
          "p",
          { className: "zz-muted" },
          "写回只走显式采纳（面板二次确认）或 zhizhang_* 工具；不静默写 chapters。",
        ),
      );
    }

    function PanelApp() {
      ensureCss();
      var st = useState({
        loading: true,
        error: null,
        hostOk: false,
        work: "",
        works: [],
        snapshot: null,
        base: "",
        empty: false,
        needWork: false,
        message: "",
        tab: "overview",
        mode: "novel",
        chapterId: "",
        readerView: "official",
        chapterBody: null,
        chapterMeta: null,
        chapterTruncated: false,
        candidateBody: null,
        candidateMeta: null,
        bodyLoading: false,
        bodyError: null,
        acceptFor: null,
        acceptMsg: null,
        acceptErr: null,
        selectedCandidateId: "",
        unifyMsg: null,
        unifyErr: null,
        unifyBusy: false,
        lastRefresh: null,
        polling: true,
        bodyEpoch: 0,
      });
      var state = st[0];
      var setState = st[1];
      var visibleRef = useRef(true);
      var busyRef = useRef(false);

      var load = useCallback(function (workKey, soft) {
        if (busyRef.current && soft) return Promise.resolve();
        busyRef.current = true;
        if (!soft) {
          setState(function (s) {
            return Object.assign({}, s, { loading: true, error: null, acceptErr: null });
          });
        }
        var q = workKey ? "?work=" + encodeURIComponent(workKey) : "";
        return fetchJson(API + "/snapshot" + q, { timeoutMs: 10000 })
          .then(function (res) {
            busyRef.current = false;
            var data = res.data || {};
            if (!res.ok && !data.snapshot) {
              throw new Error((data && data.error) || "HTTP " + res.status);
            }
            var works = data.works || [];
            var snap = data.snapshot || null;
            var nextWork = (snap && snap.workKey) || workKey || (works[0] && works[0].key) || "";
            try {
              if (nextWork) localStorage.setItem(LS_WORK, nextWork);
            } catch (e) {}
            setState(function (s) {
              var chapters = (snap && snap.chapters) || [];
              var nextCh = s.chapterId;
              if (nextCh && !chapters.some(function (c) { return c.id === nextCh; })) {
                nextCh = "";
              }
              if (!nextCh && chapters.length) {
                nextCh = chapters[0].id;
              }
              try {
                if (nextCh) localStorage.setItem(LS_CHAPTER, nextCh);
              } catch (e2) {}
              return Object.assign({}, s, {
                loading: false,
                error: null,
                hostOk: true,
                work: nextWork,
                works: works,
                snapshot: snap,
                base: data.base || (snap && snap.storageBase) || s.base || "",
                empty: !!data.empty,
                needWork: !!data.needWork,
                message: data.message || "",
                lastRefresh: new Date().toISOString(),
                acceptMsg: soft ? s.acceptMsg : null,
                chapterId: nextCh || s.chapterId,
              });
            });
          })
          .catch(function (err) {
            busyRef.current = false;
            setState(function (s) {
              return Object.assign({}, s, {
                loading: false,
                hostOk: false,
                error: (err && err.message) || String(err),
              });
            });
          });
      }, []);

      useEffect(function () {
        var saved = "";
        var savedMode = "novel";
        var savedCh = "";
        try {
          saved = localStorage.getItem(LS_WORK) || "";
          savedMode = localStorage.getItem(LS_MODE) || "novel";
          if (savedMode !== "pipeline") savedMode = "novel";
          savedCh = localStorage.getItem(LS_CHAPTER) || "";
        } catch (e) {}
        setState(function (s) {
          return Object.assign({}, s, { mode: savedMode, chapterId: savedCh });
        });
        load(saved, false);
      }, [load]);

      useEffect(function () {
        function onVis() {
          visibleRef.current = typeof document === "undefined" ? true : document.visibilityState !== "hidden";
        }
        if (typeof document !== "undefined") {
          document.addEventListener("visibilitychange", onVis);
          onVis();
        }
        var timer = setInterval(function () {
          if (!state.polling) return;
          if (!visibleRef.current) return;
          load(state.work, true);
        }, POLL_MS);
        return function () {
          clearInterval(timer);
          if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", onVis);
          }
        };
      }, [load, state.work, state.polling]);

      // slower poll when hidden — separate timer
      useEffect(function () {
        var timer = setInterval(function () {
          if (!state.polling) return;
          if (visibleRef.current) return;
          load(state.work, true);
        }, POLL_HIDDEN_MS);
        return function () { clearInterval(timer); };
      }, [load, state.work, state.polling]);

      // On-demand chapter / candidate body (not in snapshot poll)
      useEffect(function () {
        if (!state.work || !state.chapterId || state.mode !== "novel") return;
        var cancelled = false;
        setState(function (s) {
          return Object.assign({}, s, { bodyLoading: true, bodyError: null });
        });
        var chUrl =
          API +
          "/chapter?work=" +
          encodeURIComponent(state.work) +
          "&id=" +
          encodeURIComponent(state.chapterId);
        fetchJson(chUrl, { timeoutMs: 15000 })
          .then(function (res) {
            if (cancelled) return;
            var data = res.data || {};
            if (!res.ok || !data.ok) {
              throw new Error((data && data.error) || "读章失败 HTTP " + res.status);
            }
            setState(function (s) {
              return Object.assign({}, s, {
                bodyLoading: false,
                bodyError: null,
                chapterBody: data.body || "",
                chapterMeta: data.meta || null,
                chapterTruncated: !!data.truncated,
              });
            });
          })
          .catch(function (err) {
            if (cancelled) return;
            setState(function (s) {
              return Object.assign({}, s, {
                bodyLoading: false,
                bodyError: (err && err.message) || String(err),
                chapterBody: null,
                chapterMeta: null,
              });
            });
          });
        return function () {
          cancelled = true;
        };
      }, [state.work, state.chapterId, state.mode, state.bodyEpoch]);

      useEffect(function () {
        if (state.mode !== "novel" || state.readerView !== "candidate") return;
        var snap = state.snapshot;
        if (!snap || !state.work || !state.chapterId) return;
        var pending = (snap.candidates || []).filter(function (c) {
          return c.pending && c.chapterId === state.chapterId;
        });
        var candId = "";
        if (state.selectedCandidateId) {
          for (var i = 0; i < pending.length; i++) {
            if (pending[i].id === state.selectedCandidateId) {
              candId = pending[i].id;
              break;
            }
          }
        }
        if (!candId && pending.length) candId = pending[0].id;
        if (!candId) {
          setState(function (s) {
            return Object.assign({}, s, { candidateBody: null, candidateMeta: null });
          });
          return;
        }
        var cancelled = false;
        var url =
          API +
          "/candidate?work=" +
          encodeURIComponent(state.work) +
          "&id=" +
          encodeURIComponent(candId);
        fetchJson(url, { timeoutMs: 15000 })
          .then(function (res) {
            if (cancelled) return;
            var data = res.data || {};
            if (!res.ok || !data.ok) {
              throw new Error((data && data.error) || "读候选失败");
            }
            setState(function (s) {
              return Object.assign({}, s, {
                candidateBody: data.body || "",
                candidateMeta: Object.assign({}, data.meta || {}, { id: candId }),
                selectedCandidateId: candId,
              });
            });
          })
          .catch(function (err) {
            if (cancelled) return;
            setState(function (s) {
              return Object.assign({}, s, {
                bodyError: (err && err.message) || String(err),
                candidateBody: null,
              });
            });
          });
        return function () {
          cancelled = true;
        };
      }, [
        state.mode,
        state.readerView,
        state.work,
        state.chapterId,
        state.selectedCandidateId,
        state.snapshot,
        state.bodyEpoch,
      ]);

      var onRefresh = function () {
        load(state.work, false);
      };
      var onPick = function (e) {
        load(e.target.value, false);
      };

      var doAccept = function (opts) {
        var cand = state.acceptFor;
        if (!cand) return Promise.reject(new Error("无候选"));
        return fetchJson(API + "/candidate/accept", {
          method: "POST",
          timeoutMs: 20000,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            work: state.work,
            candidate: cand.id,
            confirm: true,
            force: !!opts.force,
            skipBrief: !!opts.skipBrief,
            acceptAfterEdit: !!opts.acceptAfterEdit,
            confirmAcceptAfterEdit: !!opts.confirmAcceptAfterEdit,
          }),
        }).then(function (res) {
          var data = res.data || {};
          if (!data.ok) {
            var msg = (data.code ? "[" + data.code + "] " : "") + (data.error || "采纳失败");
            return Promise.reject(new Error(msg));
          }
          setState(function (s) {
            return Object.assign({}, s, {
              acceptFor: null,
              acceptMsg: data.receipt || "已采纳",
              acceptErr: null,
              readerView: "official",
              bodyEpoch: (s.bodyEpoch || 0) + 1,
            });
          });
          return load(state.work, true);
        });
      };

      if (state.loading && !state.snapshot && !state.empty && !state.needWork) {
        return h("div", { className: "zz-root" }, h("p", { className: "zz-muted" }, "加载织章小说工作台…"));
      }

      if (state.error && !state.snapshot && !state.empty && !state.needWork) {
        return h(
          "div",
          { className: "zz-root" },
          h("div", { className: "zz-err" }, "无法连接宿主 API：", state.error),
          h(
            "p",
            { className: "zz-muted" },
            "也可让 Agent 调用 zhizhang_panel_snapshot。确认插件已 link 且 Web profile 已重启。",
          ),
          h("button", { type: "button", className: "zz-btn", onClick: onRefresh }, "重试"),
        );
      }

      var snap = state.snapshot;
      var header = h(
        "div",
        { className: "zz-top" },
        h(
          "div",
          null,
          h("h1", { className: "zz-title" }, snap ? snap.title || "织章" : "织章"),
          h(
            "p",
            { className: "zz-sub" },
            snap
              ? "key=" + (snap.workKey || "") + (snap.genre ? " · " + snap.genre : "")
              : "完整控制台",
            state.base ? " · 根 " + clip(state.base, 48) : "",
          ),
        ),
        h(
          "div",
          { className: "zz-actions" },
          state.works && state.works.length > 0
            ? h(
                "select",
                {
                  className: "zz-select",
                  value: state.work || (snap && snap.workKey) || "",
                  onChange: onPick,
                },
                state.works.map(function (w) {
                  return h("option", { key: w.key, value: w.key }, w.title || w.key);
                }),
              )
            : null,
          h(
            "div",
            { className: "zz-mode", role: "group", "aria-label": "视图模式" },
            h(
              "button",
              {
                type: "button",
                className: state.mode === "novel" ? "zz-mode-on" : "",
                onClick: function () {
                  try {
                    localStorage.setItem(LS_MODE, "novel");
                  } catch (e) {}
                  setState(Object.assign({}, state, { mode: "novel" }));
                },
              },
              "小说",
            ),
            h(
              "button",
              {
                type: "button",
                className: state.mode === "pipeline" ? "zz-mode-on" : "",
                onClick: function () {
                  try {
                    localStorage.setItem(LS_MODE, "pipeline");
                  } catch (e) {}
                  setState(Object.assign({}, state, { mode: "pipeline" }));
                },
              },
              "管线",
            ),
          ),
          h(
            "button",
            {
              type: "button",
              className: "zz-btn",
              onClick: function () {
                setState(Object.assign({}, state, { polling: !state.polling }));
              },
            },
            state.polling ? "自动刷新开" : "自动刷新关",
          ),
          h(
            "button",
            { type: "button", className: "zz-btn", onClick: onRefresh, disabled: state.loading },
            state.loading ? "刷新中…" : "刷新",
          ),
        ),
      );

      if (!snap) {
        return h(
          "div",
          { className: "zz-root" },
          header,
          h("div", { className: "zz-banner" }, state.message || "还没有作品。先用 zhizhang_project_create 创建。"),
          snapProductOnly(state),
          h("p", { className: "zz-foot" }, "写回只走显式采纳 / zhizhang_* 工具 · 面板不静默写库"),
        );
      }

      var totals = snap.totals || {};
      var pending = (snap.candidates || []).filter(function (c) {
        return c.pending;
      });
      var foundation = snap.foundation || {};
      var chapters = snap.chapters || [];
      var hints = snap.nextHints || [];
      var product = snap.product || null;
      var library = snap.library || null;
      var inspiration = snap.inspiration || null;
      var tab = state.tab;

      var tabs = h(
        "div",
        { className: "zz-tabs", role: "tablist" },
        [
          ["overview", "总览"],
          ["library", "Library"],
          ["inspiration", "Inspiration"],
          ["writing", "Writing"],
          ["ledger", "留痕"],
        ].map(function (pair) {
          return h(
            "button",
            {
              key: pair[0],
              type: "button",
              role: "tab",
              className: "zz-tab" + (tab === pair[0] ? " zz-tab-on" : ""),
              onClick: function () {
                setState(Object.assign({}, state, { tab: pair[0] }));
              },
            },
            pair[1],
          );
        }),
      );

      var badges = h(
        "div",
        { className: "zz-badges" },
        h(Badge, { tone: "zz-badge-info" }, (totals.chapters || 0) + " 章"),
        h(Badge, null, (totals.words || 0).toLocaleString("zh-CN") + " 字"),
        h(Badge, { tone: "zz-badge-ok" }, "定稿 " + (totals.final || 0)),
        h(Badge, null, "草稿 " + (totals.drafted || 0)),
        h(Badge, { tone: pending.length ? "zz-badge-warn" : "" }, "待采纳 " + pending.length),
        library
          ? h(
              Badge,
              { tone: "zz-badge-info" },
              "craft " + library.craftCount + " · mind " + library.mindCount,
            )
          : null,
      );

      var overview = h(
        "div",
        null,
        product ? h("div", { className: "zz-loop" }, product.loopLine) : null,
        product
          ? h("p", { className: "zz-muted" }, "默认写作：" + (product.writeLine || ""))
          : null,
        product
          ? h(
              "div",
              { className: "zz-grid" },
              (product.pillars || []).map(function (p) {
                return h(
                  "div",
                  { key: p.id, className: "zz-card" },
                  h("div", { className: "zz-ch-title" }, p.loopStage + ". " + p.title),
                  h("div", { className: "zz-ch-sub" }, clip(p.summary, 100)),
                );
              }),
            )
          : null,
        h("div", { className: "zz-sec" }, "下一步（Scheduler 单源）"),
        hints.length === 0
          ? h("p", { className: "zz-empty" }, "暂无提示")
          : hints.map(function (hint, i) {
              var urgent = i < 2 && /待采纳|硬拒|缺/.test(hint);
              return h(
                "div",
                { key: i, className: "zz-hint" + (urgent ? " zz-hint-urgent" : "") },
                hint,
              );
            }),
      );

      var libraryView = !library
        ? h("p", { className: "zz-empty" }, "无拆书库数据")
        : h(
            "div",
            null,
            h(
              "div",
              { className: "zz-badges" },
              h(Badge, null, "来源 " + library.sourcesCount),
              h(Badge, { tone: "zz-badge-ok" }, "已采纳 " + library.acceptedCount),
              h(Badge, null, "草稿卡 " + library.draftedCount),
              h(Badge, { tone: "zz-badge-info" }, "craft " + library.craftCount),
              h(Badge, { tone: "zz-badge-info" }, "mind " + library.mindCount),
            ),
            h("p", { className: "zz-muted" }, clip(library.summary, 200)),
            (library.sources || []).length === 0
              ? h("p", { className: "zz-empty" }, "暂无来源。Agent：zhizhang_library_import")
              : (library.sources || []).map(function (s) {
                  return h(
                    "div",
                    { key: s.id, className: "zz-card" },
                    h("div", { className: "zz-ch-title" }, s.title || s.id),
                    h(
                      "div",
                      { className: "zz-ch-sub" },
                      (s.author ? s.author + " · " : "") + s.id,
                    ),
                  );
                }),
            library.combo
              ? library.combo.ok
                ? h(
                    "p",
                    { className: "zz-muted" },
                    "combo 建议：mind「" +
                      (library.combo.mindTitle || "—") +
                      "」+ " +
                      ((library.combo.craftTitles || []).join("、") || "—"),
                  )
                : h("p", { className: "zz-muted" }, "combo：" + (library.combo.emptyReason || "暂无"))
              : null,
          );

      var insp = inspiration;
      var inspirationView = !insp
        ? h("p", { className: "zz-empty" }, "无灵感数据")
        : h(
            "div",
            null,
            h(
              "div",
              { className: "zz-badges" },
              h(Badge, null, "会话 " + insp.sessionsCount),
              h(Badge, { tone: "zz-badge-warn" }, "待 emit " + insp.pendingEmits),
              h(
                Badge,
                { tone: insp.appliedToWork ? "zz-badge-ok" : "" },
                insp.appliedToWork ? "已 apply" : "未 apply",
              ),
              h(
                Badge,
                { tone: insp.foundationFilled ? "zz-badge-ok" : "" },
                "根基字段 " + (insp.foundationFilledFields || []).length,
              ),
            ),
            h(
              "p",
              { className: "zz-muted" },
              "三纲进度：处境 " +
                (insp.outlineProgress && insp.outlineProgress.withSituation) +
                "/" +
                (insp.outlineProgress && insp.outlineProgress.total) +
                " · 场面 " +
                (insp.outlineProgress && insp.outlineProgress.withLived) +
                " · 状态 " +
                (insp.outlineProgress && insp.outlineProgress.withState) +
                " · 齐备 " +
                (insp.outlineProgress && insp.outlineProgress.complete),
            ),
            (insp.sessions || []).length === 0
              ? h("p", { className: "zz-empty" }, "暂无灵感会话")
              : (insp.sessions || []).map(function (s) {
                  return h(
                    "div",
                    { key: s.id, className: "zz-card" },
                    h("div", { className: "zz-ch-title" }, clip(s.goal, 56)),
                    h(
                      "div",
                      { className: "zz-ch-sub" },
                      s.id + " · " + s.cardCount + " 卡" + (s.forgeAt ? " · 已 forge" : ""),
                    ),
                  );
                }),
          );

      var writingView = h(
        "div",
        null,
        h("div", { className: "zz-sec" }, "当前小说状态"),
        h("p", { className: "zz-muted" }, "低权重摘要（忌称账本）"),
        h(
          "div",
          { className: "zz-card" },
          h("div", { className: "zz-muted" }, "锁"),
          h("div", null, clip(foundation.locks, 200) || "—"),
          h("div", { className: "zz-muted", style: { marginTop: 8 } }, "已发生"),
          h("div", null, clip(foundation.happened, 240) || "—"),
          h("div", { className: "zz-muted", style: { marginTop: 8 } }, "线头"),
          h("div", null, clip(foundation.threads, 160) || "—"),
          h("div", { className: "zz-muted", style: { marginTop: 8 } }, "调性"),
          h("div", null, clip(foundation.style, 120) || "—"),
        ),
        h("div", { className: "zz-sec" }, "章节"),
        chapters.length === 0
          ? h("p", { className: "zz-empty" }, "暂无章节")
          : chapters.map(function (c) {
              return h(
                "div",
                { key: c.id, className: "zz-ch", "data-status": c.status },
                h("span", { className: "zz-dot zz-dot-" + (c.status || "draft") }),
                h(
                  "div",
                  null,
                  h(
                    "div",
                    { className: "zz-ch-title" },
                    c.title,
                    c.briefRecent ? h(Badge, { tone: "zz-badge-ok" }, " brief✓") : null,
                  ),
                  h(
                    "div",
                    { className: "zz-ch-sub" },
                    statusLabel(c.status) +
                      (c.situationLens ? " · 处境：" + clip(c.situationLens, 72) : ""),
                  ),
                ),
                h("div", { className: "zz-muted" }, (c.wordCount || 0) + " 字"),
              );
            }),
        h("div", { className: "zz-sec" }, "待采纳候选"),
        pending.length === 0
          ? h("p", { className: "zz-empty" }, "无待采纳。")
          : pending.map(function (c) {
              return h(
                "div",
                { key: c.id, className: "zz-cand" },
                h("strong", null, c.draftLabel ? "「" + c.draftLabel + "」 " + c.id : c.id),
                " → ",
                c.chapterId,
                " · ",
                c.wordCount,
                " 字",
                c.note ? h("div", { className: "zz-muted" }, clip(c.note, 80)) : null,
                h(
                  "div",
                  { className: "zz-muted" },
                  (c.hasLintPass ? "lint✓" : "缺 lint") +
                    (c.editOf ? " · 编辑自 " + c.editOf : "") +
                    (c.unifyOf && c.unifyOf.length ? " · 整理自 " + c.unifyOf.length + " 稿" : "") +
                    (c.lintHitCount ? " · hits " + c.lintHitCount : ""),
                ),
                h(
                  "div",
                  { className: "zz-cand-actions" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "zz-btn zz-btn-primary",
                      onClick: function () {
                        setState(
                          Object.assign({}, state, {
                            acceptFor: c,
                            acceptErr: null,
                            acceptMsg: null,
                          }),
                        );
                      },
                    },
                    "采纳",
                  ),
                  h(
                    "span",
                    { className: "zz-muted" },
                    "二次确认 · 同 Accept 硬闸",
                  ),
                ),
              );
            }),
        h(
          "p",
          { className: "zz-muted" },
          "编辑 A/B/C 仍走工具 zhizhang_candidate_edit_decide；面板只做正式采纳。",
        ),
      );

      var ledgerView = h(
        "div",
        null,
        h(
          "details",
          { className: "zz-fold", open: true },
          h("summary", null, "审校留痕（最近）"),
          (snap.ledgerRecent || []).length === 0
            ? h("p", { className: "zz-empty" }, "无")
            : h(
                "ul",
                null,
                (snap.ledgerRecent || [])
                  .slice(-8)
                  .reverse()
                  .map(function (e) {
                    return h(
                      "li",
                      { key: e.id || e.at + e.kind },
                      "[" + e.at + "] " + e.kind + " · " + e.chapterId + " · " + clip(e.summary, 72),
                    );
                  }),
              ),
        ),
        h(
          "details",
          { className: "zz-fold", open: true },
          h("summary", null, "brief 留痕（近期）"),
          (snap.briefCrumbsRecent || []).length === 0
            ? h("p", { className: "zz-empty" }, "无")
            : h(
                "ul",
                null,
                (snap.briefCrumbsRecent || [])
                  .slice(-8)
                  .reverse()
                  .map(function (e, i) {
                    return h(
                      "li",
                      { key: (e.chapterId || "") + e.at + i },
                      e.chapterId +
                        " @ " +
                        e.at +
                        " · " +
                        ((e.assetIds || []).join(",") || "—"),
                    );
                  }),
              ),
        ),
        h(
          "details",
          { className: "zz-fold" },
          h("summary", null, "兑付摘要（可选 · 不进默认链）"),
          Object.keys(snap.lastPayoffByChapter || {}).length === 0
            ? h("p", { className: "zz-empty" }, "无（例行三 audit 不在默认创作路径）")
            : h(
                "ul",
                null,
                Object.keys(snap.lastPayoffByChapter || {}).map(function (k) {
                  var e = snap.lastPayoffByChapter[k];
                  return h(
                    "li",
                    { key: k },
                    e.chapterId +
                      " · " +
                      (e.ok ? "ok" : "warn:" + e.warningCount) +
                      " · " +
                      clip(e.summary, 72),
                  );
                }),
              ),
        ),
      );


      function selectChapter(id) {
        try {
          localStorage.setItem(LS_CHAPTER, id);
        } catch (e) {}
        setState(
          Object.assign({}, state, {
            chapterId: id,
            readerView: "official",
            candidateBody: null,
            candidateMeta: null,
            selectedCandidateId: "",
            bodyError: null,
            unifyMsg: null,
            unifyErr: null,
          }),
        );
      }

      function pendingForChapter(chId) {
        return pending.filter(function (c) {
          return c.chapterId === chId;
        });
      }

      var leftList =
        chapters.length === 0
          ? h("p", { className: "zz-empty" }, "暂无章节。用 Agent 创建后再来读。")
          : chapters.map(function (c) {
              var pcs = pendingForChapter(c.id);
              return h(
                "div",
                { key: c.id },
                h(
                  "div",
                  {
                    className: "zz-ch-item" + (state.chapterId === c.id ? " zz-ch-on" : ""),
                    role: "button",
                    tabIndex: 0,
                    onClick: function () {
                      selectChapter(c.id);
                    },
                    onKeyDown: function (e) {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectChapter(c.id);
                      }
                    },
                  },
                  h("span", { className: "zz-dot zz-dot-" + (c.status || "draft") }),
                  h(
                    "div",
                    null,
                    h(
                      "div",
                      { className: "zz-ch-title" },
                      c.title,
                      c.briefRecent ? " · brief✓" : "",
                    ),
                    h(
                      "div",
                      { className: "zz-ch-sub" },
                      statusLabel(c.status) +
                        (c.situationLens ? " · " + clip(c.situationLens, 36) : ""),
                    ),
                  ),
                  h("div", { className: "zz-muted" }, (c.wordCount || 0) + " 字"),
                ),
                pcs.map(function (pc) {
                  var on =
                    state.chapterId === c.id &&
                    state.readerView === "candidate" &&
                    state.selectedCandidateId === pc.id;
                  return h(
                    "div",
                    {
                      key: pc.id,
                      className: "zz-cand-mini" + (on ? " zz-ch-on" : ""),
                      onClick: function () {
                        setState(function (s) {
                          return Object.assign({}, s, {
                            chapterId: c.id,
                            readerView: "candidate",
                            selectedCandidateId: pc.id,
                            candidateBody: null,
                            candidateMeta: null,
                          });
                        });
                        try {
                          localStorage.setItem(LS_CHAPTER, c.id);
                        } catch (e) {}
                      },
                    },
                    (pc.draftLabel ? "「" + pc.draftLabel + "」 " : "待采纳 ") +
                      pc.id +
                      " · " +
                      (pc.wordCount || 0) +
                      " 字" +
                      (pc.hasLintPass ? " · lint✓" : " · 缺 lint") +
                      (pc.source === "unify" ? " · 整理" : ""),
                  );
                }),
              );
            });

      var chPending = state.chapterId ? pendingForChapter(state.chapterId) : [];
      var activeCand = null;
      if (state.selectedCandidateId) {
        for (var ai = 0; ai < chPending.length; ai++) {
          if (chPending[ai].id === state.selectedCandidateId) {
            activeCand = chPending[ai];
            break;
          }
        }
      }
      if (!activeCand && chPending.length) activeCand = chPending[0];
      var multiDraftOn = !!(snap && snap.multiDraftEnabled);
      var doUnifyPrepare = function () {
        if (!state.work || !state.chapterId || chPending.length < 2) return;
        setState(Object.assign({}, state, { unifyBusy: true, unifyErr: null, unifyMsg: null }));
        var ids = chPending.map(function (c) {
          return c.id;
        });
        fetchJson(API + "/unify/prepare", {
          method: "POST",
          timeoutMs: 15000,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            work: state.work,
            chapter: state.chapterId,
            candidate_ids: ids,
          }),
        })
          .then(function (res) {
            var data = res.data || {};
            if (!data.ok) {
              throw new Error((data && data.error) || data.code || "统一整理 brief 失败");
            }
            var brief = data.brief || "";
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(brief);
              }
            } catch (e) {}
            setState(function (s) {
              return Object.assign({}, s, {
                unifyBusy: false,
                unifyMsg:
                  "已生成统一整理 brief（" +
                  (data.candidateIds || ids).length +
                  " 稿）并尝试复制到剪贴板。请把 brief 贴给对话里的 Agent，写完后走 unify_stage → lint → accept。",
                unifyErr: null,
              });
            });
          })
          .catch(function (err) {
            setState(function (s) {
              return Object.assign({}, s, {
                unifyBusy: false,
                unifyErr: (err && err.message) || String(err),
              });
            });
          });
      };

      var readerToolbar = h(
        "div",
        { className: "zz-reader-toolbar" },
        h(
          "div",
          { className: "zz-mode" },
          h(
            "button",
            {
              type: "button",
              className: state.readerView === "official" ? "zz-mode-on" : "",
              onClick: function () {
                setState(Object.assign({}, state, { readerView: "official" }));
              },
            },
            "正式章",
          ),
          h(
            "button",
            {
              type: "button",
              className: state.readerView === "candidate" ? "zz-mode-on" : "",
              disabled: !activeCand,
              onClick: function () {
                if (!activeCand) return;
                setState(Object.assign({}, state, { readerView: "candidate" }));
              },
            },
            activeCand ? "候选对照" : "无待采纳",
          ),
        ),
        state.chapterTruncated && state.readerView === "official"
          ? h("span", { className: "zz-muted" }, "正文已截断（约 400KB）")
          : null,
      );

      var readerContent;
      if (!state.chapterId) {
        readerContent = h(
          "div",
          { className: "zz-empty zz-empty-card" },
          h("p", null, "选左侧章节开始阅读"),
          h("p", { className: "zz-muted", style: { marginTop: 8 } }, "有正文即可点开；空章请先让 Agent 起草再刷新。"),
        );
      } else if (state.bodyLoading && state.readerView === "official" && state.chapterBody == null) {
        readerContent = h("p", { className: "zz-muted" }, "加载正文…");
      } else if (state.bodyError && state.readerView === "official") {
        readerContent = h("div", { className: "zz-err" }, state.bodyError);
      } else if (state.readerView === "candidate") {
        if (!activeCand) {
          readerContent = h("p", { className: "zz-empty" }, "本章无待采纳候选。");
        } else if (state.candidateBody == null) {
          readerContent = h("p", { className: "zz-muted" }, "加载候选正文…");
        } else {
          var emptyCand = !String(state.candidateBody).trim();
          readerContent = emptyCand
            ? h("p", { className: "zz-empty" }, "候选正文为空。")
            : h("div", {
                className: "zz-reader",
                dangerouslySetInnerHTML: { __html: lightMdToHtml(state.candidateBody) },
              });
        }
      } else {
        var bodyText = state.chapterBody == null ? "" : state.chapterBody;
        if (!String(bodyText).trim()) {
          readerContent = h(
            "div",
            { className: "zz-empty zz-empty-card" },
            h("p", null, "本章还没有正文"),
            h(
              "p",
              { className: "zz-muted", style: { marginTop: 8 } },
              "在对话里让 Agent：chapter_brief(lean) → 写出 → candidate_stage → style_lint → accept。",
            ),
            h(
              "p",
              { className: "zz-muted", style: { marginTop: 6 } },
              "可选：写后编辑 A/B/C；或多草稿（默认关）再统一整理。",
            ),
          );
        } else {
          readerContent = h("div", {
            className: "zz-reader",
            dangerouslySetInnerHTML: { __html: lightMdToHtml(bodyText) },
          });
        }
      }

      var rightGate = h(
        "div",
        null,
        h("div", { className: "zz-sec" }, "本章闸"),
        state.chapterId
          ? h(
              "div",
              { className: "zz-card" },
              (function () {
                var ch = chapters.find(function (c) {
                  return c.id === state.chapterId;
                });
                return h(
                  "div",
                  null,
                  h(
                    "div",
                    { className: "zz-gate " + (ch && ch.briefRecent ? "zz-gate-ok" : "zz-gate-bad") },
                    ch && ch.briefRecent ? "brief✓ 近期已跑" : "brief：未见近期留痕",
                  ),
                  h(
                    "div",
                    {
                      className:
                        "zz-gate " + (activeCand && activeCand.hasLintPass ? "zz-gate-ok" : "zz-gate-bad"),
                    },
                    activeCand
                      ? activeCand.hasLintPass
                        ? "lint✓ 可走采纳闸"
                        : "lint：待采纳缺 lint，硬拒"
                      : "lint：无待采纳",
                  ),
                  h(
                    "div",
                    { className: "zz-gate" },
                    activeCand ? "待采纳：" + activeCand.id : "待采纳：无",
                  ),
                );
              })(),
            )
          : h("p", { className: "zz-empty" }, "未选章"),
        chPending.length
          ? h(
              "div",
              { className: "zz-cand" },
              h("strong", null, "待采纳（" + chPending.length + "）"),
              chPending.map(function (pc) {
                return h(
                  "div",
                  {
                    key: pc.id,
                    className: "zz-muted",
                    style: {
                      marginTop: 4,
                      cursor: "pointer",
                      fontWeight: activeCand && activeCand.id === pc.id ? 600 : 400,
                    },
                    onClick: function () {
                      setState(
                        Object.assign({}, state, {
                          readerView: "candidate",
                          selectedCandidateId: pc.id,
                          candidateBody: null,
                        }),
                      );
                    },
                  },
                  (pc.draftLabel ? "「" + pc.draftLabel + "」 " : "") +
                    pc.id +
                    " · " +
                    (pc.wordCount || 0) +
                    " 字" +
                    (pc.hasLintPass ? " · lint✓" : " · 缺 lint"),
                );
              }),
              activeCand
                ? h(
                    "div",
                    { className: "zz-cand-actions", style: { marginTop: 8 } },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "zz-btn zz-btn-primary",
                        onClick: function () {
                          setState(
                            Object.assign({}, state, {
                              acceptFor: activeCand,
                              acceptErr: null,
                              acceptMsg: null,
                            }),
                          );
                        },
                      },
                      "采纳当前",
                    ),
                    h("span", { className: "zz-muted" }, "二次确认 · Accept 硬闸"),
                  )
                : null,
              multiDraftOn && chPending.length >= 2
                ? h(
                    "div",
                    { className: "zz-cand-actions", style: { marginTop: 8 } },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "zz-btn",
                        disabled: !!state.unifyBusy,
                        onClick: doUnifyPrepare,
                      },
                      state.unifyBusy ? "生成中…" : "统一整理",
                    ),
                    h(
                      "span",
                      { className: "zz-muted" },
                      "只出 brief，不写盘；Agent 整理后再 unify_stage",
                    ),
                  )
                : !multiDraftOn && chPending.length >= 2
                  ? h(
                      "p",
                      { className: "zz-muted", style: { marginTop: 8 } },
                      "同章多稿：开启 multiDraft 后可统一整理（默认关）",
                    )
                  : null,
              state.unifyMsg ? h("div", { className: "zz-ok" }, state.unifyMsg) : null,
              state.unifyErr ? h("div", { className: "zz-err" }, state.unifyErr) : null,
            )
          : null,
        activeCand && activeCand.editOf
          ? h(
              "div",
              { className: "zz-edit-card" },
              h("strong", null, "编辑抉择 A / B / C"),
              h(
                "ol",
                null,
                h("li", null, "A · 确认采纳编辑稿并验收为正式章（面板采纳即路径 A，须二次确认）"),
                h("li", null, "B · 只留下编辑候选，稍后再验（工具 edit_decide）"),
                h("li", null, "C · 拒编辑或换模式重跑（工具 edit_decide）"),
              ),
              h(
                "p",
                { className: "zz-muted", style: { marginTop: 8 } },
                "未表态按 B。完整 decide 走 zhizhang_candidate_edit_decide；面板只做正式采纳。",
              ),
            )
          : h(
              "div",
              { className: "zz-edit-card" },
              h("strong", null, "写后可选编辑"),
              h(
                "p",
                { className: "zz-muted", style: { margin: 0 } },
                "lint 后可 edit_brief → 改写 → edit_stage；用户选 A/B/C。非每章必经，不进默认最短链。",
              ),
            ),
        h("div", { className: "zz-sec" }, "当前小说状态"),
        h(
          "div",
          { className: "zz-card" },
          h("div", { className: "zz-muted" }, "锁"),
          h("div", null, clip(foundation.locks, 160) || "—"),
          h("div", { className: "zz-muted", style: { marginTop: 8 } }, "已发生"),
          h("div", null, clip(foundation.happened, 200) || "—"),
          h("div", { className: "zz-muted", style: { marginTop: 8 } }, "线头"),
          h("div", null, clip(foundation.threads, 120) || "—"),
          h("div", { className: "zz-muted", style: { marginTop: 8 } }, "调性"),
          h("div", null, clip(foundation.style, 100) || "—"),
        ),
        h("div", { className: "zz-sec" }, "下一步"),
        hints.length === 0
          ? h("p", { className: "zz-empty" }, "暂无")
          : hints.slice(0, 4).map(function (hint, i) {
              return h(
                "div",
                { key: i, className: "zz-hint" + (i < 2 && /待采纳|硬拒|缺/.test(hint) ? " zz-hint-urgent" : "") },
                hint,
              );
            }),
        h(
          "p",
          { className: "zz-muted", style: { marginTop: 10 } },
          "0.15 · 多草稿默认关 · 编辑 A/B/C 可选 · 产文靠对话 Agent",
        ),
      );

      var workbench = h(
        "div",
        { className: "zz-workbench" },
        h(
          "div",
          { className: "zz-wb-col zz-wb-left" },
          h("div", { className: "zz-wb-head" }, "章节"),
          h("div", { className: "zz-wb-body" }, leftList),
        ),
        h(
          "div",
          { className: "zz-wb-col zz-wb-center" },
          h(
            "div",
            { className: "zz-wb-head" },
            state.chapterMeta
              ? (state.chapterMeta.title || state.chapterId) +
                  (state.readerView === "candidate" ? " · 候选对照" : " · 正式章")
              : "阅读",
          ),
          h("div", { className: "zz-wb-body" }, readerToolbar, readerContent),
        ),
        h(
          "div",
          { className: "zz-wb-col zz-wb-right" },
          h("div", { className: "zz-wb-head" }, "状态与闸"),
          h("div", { className: "zz-wb-body" }, rightGate),
        ),
      );

      var body =
        tab === "library"
          ? libraryView
          : tab === "inspiration"
            ? inspirationView
            : tab === "writing"
              ? writingView
              : tab === "ledger"
                ? ledgerView
                : overview;

      var main =
        state.mode === "novel"
          ? workbench
          : h("div", null, badges, tabs, body);

      return h(
        "div",
        {
          className: "zz-root",
          "data-work": snap.workKey,
          "data-mode": state.mode,
        },
        header,
        !state.hostOk
          ? h("div", { className: "zz-err" }, "宿主 API 异常，显示的是上次成功数据。")
          : null,
        state.acceptMsg ? h("div", { className: "zz-ok" }, state.acceptMsg) : null,
        state.acceptErr ? h("div", { className: "zz-err" }, state.acceptErr) : null,
        state.mode === "novel" ? badges : null,
        main,
        h(
          "p",
          { className: "zz-foot" },
          state.mode === "novel" ? "织章 · 小说工作台 " : "织章 · 管线 ",
          "nextHints=Scheduler · 采纳=Accept 硬闸 · ",
          h("span", { className: "zz-poll" }, state.polling ? "自动刷新 ~6s" : "自动刷新已关"),
          state.lastRefresh ? " · 上次 " + state.lastRefresh : "",
        ),
        state.acceptFor
          ? h(AcceptDialog, {
              cand: state.acceptFor,
              onCancel: function () {
                setState(Object.assign({}, state, { acceptFor: null }));
              },
              onConfirm: doAccept,
            })
          : null,
      );
    }

    function snapProductOnly(state) {
      return h(
        "div",
        { className: "zz-banner" },
        "创建作品后可在此查看三柱进度、待采纳真采纳与 Scheduler 下一步。",
      );
    }

    function MainPage() {
      return h(PanelApp, null);
    }

    function registerOfficialPanel(ctx, disposers) {
      if (!ctx.slots || typeof ctx.slots.inject !== "function") return false;
      if (!slotDeclared(ctx, "sidebar.panellist") || !slotDeclared(ctx, "main")) return false;
      var pageDispose = null;
      try {
        pageDispose = ctx.slots.inject("main", function () {
          return ctx.slots.register(
            {
              name: "main",
              key: PANEL_ID,
              inject: function () {
                return {};
              },
            },
            MainPage,
          );
        });
        var rowDispose = ctx.slots.inject("sidebar.panellist", function () {
          return ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: function () {
                return "织章";
              },
            },
            SidebarIcon,
          );
        });
        if (typeof rowDispose === "function") disposers.push(rowDispose);
        if (typeof pageDispose === "function") disposers.push(pageDispose);
        return true;
      } catch (error) {
        try {
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[dsh-zhizhang] official panel seat failed:", error);
          }
        } catch (e) {}
        if (typeof pageDispose === "function") {
          try {
            pageDispose();
          } catch (e2) {}
        }
        return false;
      }
    }

    function registerSettingsCard(ctx, disposers) {
      if (!ctx.slots || typeof ctx.slots.inject !== "function") return false;
      if (!slotDeclared(ctx, "settings.plugin.item")) return false;
      try {
        var d = ctx.slots.inject("settings.plugin.item", function () {
          return ctx.slots.register(
            {
              name: "settings.plugin.item",
              key: SETTINGS_KEY,
              id: SETTINGS_KEY,
              order: 108,
              inject: function () {
                return {};
              },
            },
            SettingsCard,
          );
        });
        if (typeof d === "function") disposers.push(d);
        return true;
      } catch (error) {
        try {
          if (typeof console !== "undefined" && console.info) {
            console.info("[dsh-zhizhang] settings.plugin.item skipped:", error);
          }
        } catch (e) {}
        return false;
      }
    }

    var inject = ["slots"];
    var applied = false;

    function apply(ctx) {
      if (applied) return;
      applied = true;
      var disposers = [];
      var ok = registerOfficialPanel(ctx, disposers);
      registerSettingsCard(ctx, disposers);
      if (!ok) {
        try {
          if (typeof console !== "undefined" && console.info) {
            console.info("[dsh-zhizhang] sidebar seats unavailable; UI skipped");
          }
        } catch (e) {}
      }
      if (typeof ctx.effect === "function") {
        ctx.effect(function () {
          return function () {
            for (var i = 0; i < disposers.length; i++) {
              try {
                if (typeof disposers[i] === "function") disposers[i]();
              } catch (e) {}
            }
          };
        }, "dsh-zhizhang: panel seats");
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__testing = {
      PANEL_ID: PANEL_ID,
      API: API,
      POLL_MS: POLL_MS,
      LS_CHAPTER: LS_CHAPTER,
      lightMdToHtml: lightMdToHtml,
      slotDeclared: slotDeclared,
    };
    return module.exports;
  },
});
