/** Small presentational pieces shared by the panel views (pure props). */
import React from "react";
import { t } from "../copy.js";
import { Button, Icon, StateDot, Tag, cx } from "../ui.jsx";

const { useEffect, useState } = React;

export const STATUS_TONE = { final: "success", reviewed: "info", drafted: "warning", draft: "warning", planned: "quiet" };
export const STATUS_DOT = { final: "done", reviewed: "done", drafted: "warning", draft: "warning", planned: "idle" };

export function statusLabel(status) {
  if (status === "final") return t("statusFinal");
  if (status === "reviewed") return t("statusReviewed");
  if (status === "planned") return t("statusPlanned");
  return t("statusDrafted");
}

export function clip(value, n) {
  const text = String(value == null ? "" : value).trim();
  return text.length <= n ? text : text.slice(0, n) + "…";
}

export function StatusTag({ status }) {
  return <Tag tone={STATUS_TONE[status] || "neutral"}>{statusLabel(status)}</Tag>;
}

export function StatusDot({ status }) {
  return <StateDot state={STATUS_DOT[status] || "idle"} size={8} />;
}

export function Section({ title, aside, children, className }) {
  return (
    <section className={cx("zz-section", className)}>
      {title ? (
        <header className="zz-section-head">
          <h3 className="zz-section-title">{title}</h3>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Empty({ title, hint, children }) {
  return (
    <div className="zz-empty">
      {title ? <p className="zz-empty-title">{title}</p> : null}
      {hint ? <p className="zz-empty-hint">{hint}</p> : null}
      {children}
    </div>
  );
}

export function Skeleton({ lines = 6 }) {
  const rows = [];
  for (let i = 0; i < lines; i += 1) rows.push(<span key={i} className={cx("zz-skeleton", i === lines - 1 && "zz-skeleton-short")} />);
  return (
    <div className="zz-skeleton-stack" aria-hidden="true">
      {rows}
    </div>
  );
}

export function Callout({ tone = "info", role, children, onDismiss }) {
  return (
    <div className="zz-callout" data-tone={tone} role={role}>
      {tone === "danger" || tone === "warning" ? <Icon name="alert" size={14} /> : null}
      <div className="zz-callout-text">{children}</div>
      {onDismiss ? (
        <button type="button" className="zz-icon-button zz-callout-close" aria-label={t("close")} onClick={onDismiss}>
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </div>
  );
}

/** Transient feedback; success fades out on its own, errors stay until dismissed. */
function splitDetail(text) {
  const s = String(text || "");
  const at = s.indexOf("\n");
  return at < 0 ? [s, ""] : [s.slice(0, at), s.slice(at + 1).trim()];
}

export function Notices({ notices, onDismiss }) {
  useEffect(() => {
    // Short confirmations fade; receipts with details stay until the author closes them.
    const timers = notices.filter((n) => n.tone === "success" && !splitDetail(n.text)[1]).map((n) => setTimeout(() => onDismiss(n.id), 5000));
    return () => timers.forEach(clearTimeout);
  }, [notices, onDismiss]);
  if (!notices.length) return null;
  return (
    <div className="zz-notices" aria-live="polite">
      {notices.map((n) => {
        const [head, detail] = splitDetail(n.text);
        return (
          <Callout key={n.id} tone={n.tone} role={n.tone === "danger" ? "alert" : "status"} onDismiss={() => onDismiss(n.id)}>
            {head}
            {detail ? (
              <details className="zz-callout-detail">
                <summary>{t("details")}</summary>
                <div>{detail}</div>
              </details>
            ) : null}
          </Callout>
        );
      })}
    </div>
  );
}

export function Foundation({ foundation, limit = 240 }) {
  const f = foundation || {};
  const rows = [
    ["foundationLocks", f.locks],
    ["foundationHappened", f.happened],
    ["foundationThreads", f.threads],
    ["foundationStyle", f.style],
  ];
  return (
    <dl className="zz-facts">
      {rows.map(([key, value]) => (
        <div key={key} className="zz-fact">
          <dt>{t(key)}</dt>
          <dd>{clip(value, limit) || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

const URGENT = /待采纳|硬拒|缺|修订待核对|不可读|未过/;

export function Hints({ hints, initial = 4 }) {
  const [open, setOpen] = useState(false);
  const list = hints || [];
  if (!list.length) return <p className="zz-muted">{t("noHints")}</p>;
  const shown = open ? list : list.slice(0, initial);
  return (
    <div className="zz-hints">
      <ol className="zz-hint-list">
        {shown.map((hint, i) => (
          <li key={i} className={cx("zz-hint", URGENT.test(hint) && "zz-hint-urgent")}>
            {hint}
          </li>
        ))}
      </ol>
      {list.length > initial ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
          {open ? t("less") : t("more")}
        </Button>
      ) : null}
    </div>
  );
}

export function Code({ children }) {
  return <code className="zz-code">{children}</code>;
}

/** Copy with a single `{code}` placeholder rendered as inline code. */
export function WithCode({ text, code }) {
  const parts = text.split("{code}");
  return (
    <>
      {parts[0]}
      {parts.length > 1 ? <Code>{code}</Code> : null}
      {parts.slice(1).join("")}
    </>
  );
}
