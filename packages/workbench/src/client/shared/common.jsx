/** 两种模式共用的展示组件（纯 props）。 */
import React from "react";
import { t } from "./copy.js";
import { Button, Icon, Spinner, StateDot, Tag, cx, toBody } from "./ui.jsx";

const { useCallback, useEffect, useRef, useState } = React;

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
    <section className={cx("wb-section", className)}>
      {title ? (
        <header className="wb-section-head">
          <h3 className="wb-section-title">{title}</h3>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Empty({ title, hint, icon, children }) {
  return (
    <div className="wb-empty">
      {icon ? <span className="wb-empty-icon"><Icon name={icon} size={20} /></span> : null}
      {title ? <p className="wb-empty-title">{title}</p> : null}
      {hint ? <p className="wb-empty-hint">{hint}</p> : null}
      {children}
    </div>
  );
}

export function Skeleton({ lines = 6 }) {
  const rows = [];
  for (let i = 0; i < lines; i += 1) rows.push(<span key={i} className={cx("wb-skeleton", i === lines - 1 && "wb-skeleton-short")} />);
  return (
    <div className="wb-skeleton-stack" aria-hidden="true">
      {rows}
    </div>
  );
}

export function Callout({ tone = "info", role, children, onDismiss }) {
  return (
    <div className="wb-callout" data-tone={tone} role={role}>
      {tone === "danger" || tone === "warning" ? <Icon name="alert" size={14} /> : null}
      <div className="wb-callout-text">{children}</div>
      {onDismiss ? (
        <button type="button" className="wb-icon-button wb-callout-close" aria-label={t("close")} onClick={onDismiss}>
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </div>
  );
}

function splitDetail(text) {
  const s = String(text || "");
  const at = s.indexOf("\n");
  return at < 0 ? [s, ""] : [s.slice(0, at), s.slice(at + 1).trim()];
}

const TOAST_ICON = { success: "circleCheck", danger: "alert", warning: "alert", info: "info" };
const TOAST_MS = { success: 4500, info: 6000, warning: 9000 };

/** 一条提示：成功与信息类自己淡出（悬停暂停），出错的留到作者关掉 */
function Toast({ notice, onDismiss }) {
  const [head, detail] = splitDetail(notice.text);
  const life = notice.tone === "danger" || detail ? 0 : TOAST_MS[notice.tone] || 6000;
  const [leaving, setLeaving] = useState(false);
  const left = useRef(life);
  const started = useRef(0);
  const timer = useRef(null);
  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onDismiss(notice.id), 180);
  }, [notice.id, onDismiss]);
  const run = useCallback(() => {
    if (!life) return;
    started.current = Date.now();
    timer.current = setTimeout(close, left.current);
  }, [life, close]);
  const pause = useCallback(() => {
    if (!life || !timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    left.current -= Date.now() - started.current;
  }, [life]);
  useEffect(() => { run(); return () => clearTimeout(timer.current); }, [run]);
  return (
    <div
      className={cx("wb-toast", leaving && "wb-toast-leave")}
      data-tone={notice.tone}
      role={notice.tone === "danger" ? "alert" : "status"}
      onMouseEnter={pause}
      onMouseLeave={run}
      onFocus={pause}
      onBlur={run}
    >
      <span className="wb-toast-icon"><Icon name={TOAST_ICON[notice.tone] || "info"} size={16} /></span>
      <div className="wb-toast-body">
        <p className="wb-toast-text">{head}</p>
        {detail ? (
          <details className="wb-callout-detail">
            <summary>{t("details")}</summary>
            <div>{detail}</div>
          </details>
        ) : null}
      </div>
      <button type="button" className="wb-icon-button wb-toast-close" aria-label={t("close")} onClick={close}>
        <Icon name="close" size={14} />
      </button>
      {life ? <span className="wb-toast-timer" style={{ animationDuration: life + "ms" }} aria-hidden="true" /> : null}
    </div>
  );
}

/** 操作反馈：右下角的提示栈，最多三条 */
export function Notices({ notices, onDismiss }) {
  if (!notices.length) return null;
  return toBody(
    <div className="wb-scope">
      <div className="wb-toasts" aria-live="polite">
        {notices.map((n) => <Toast key={n.id} notice={n} onDismiss={onDismiss} />)}
      </div>
    </div>
  );
}

/** 动作卡片：图标 + 标题 + 一句说明；进行中显示转圈 */
export function ActionCard({ icon, title, hint, onClick, disabled, busy, primary, offReason }) {
  return (
    <button
      type="button"
      className={cx("wb-action-card", primary && "wb-action-card-primary", busy && "wb-action-card-busy")}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      title={disabled && offReason ? offReason : undefined}
      onClick={onClick}
    >
      <span className="wb-action-card-icon">{busy ? <Spinner size={16} /> : <Icon name={icon} size={16} />}</span>
      <span className="wb-action-card-text">
        <span className="wb-action-card-title">{title}</span>
        {busy ? <span className="wb-action-card-hint">{t("deliverBusy")}</span> : hint ? <span className="wb-action-card-hint">{hint}</span> : null}
      </span>
      <span className="wb-action-card-go"><Icon name="chevron" size={14} /></span>
    </button>
  );
}

/** 步骤条：current 之前已完成，current 为当前（tone 可为 warning / danger） */
export function Steps({ steps, current, tone, label }) {
  return (
    <ol className="wb-stepper" aria-label={label} style={{ gridTemplateColumns: "repeat(" + steps.length + ", 1fr)" }}>
      {steps.map((name, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={name} className="wb-step" data-state={state} data-tone={i === current ? tone : undefined} aria-current={i === current ? "step" : undefined}>
            <span className="wb-step-mark" aria-hidden="true">{state === "done" ? <Icon name="check" size={10} /> : null}</span>
            <span className="wb-step-label">{name}</span>
          </li>
        );
      })}
    </ol>
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
    <dl className="wb-facts">
      {rows.map(([key, value]) => (
        <div key={key} className="wb-fact">
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
  if (!list.length) return <p className="wb-muted">{t("noHints")}</p>;
  const shown = open ? list : list.slice(0, initial);
  return (
    <div className="wb-hints">
      <ol className="wb-hint-list">
        {shown.map((hint, i) => (
          <li key={i} className={cx("wb-hint", URGENT.test(hint) && "wb-hint-urgent")}>
            <Icon name={URGENT.test(hint) ? "alert" : "chevron"} size={12} />
            <span>{hint}</span>
          </li>
        ))}
      </ol>
      {list.length > initial ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} icon={<span className={cx("wb-more-chevron", open && "wb-more-open")}><Icon name="chevron" size={12} /></span>}>
          {open ? t("less") : t("more")}
        </Button>
      ) : null}
    </div>
  );
}

export function Code({ children }) {
  return <code className="wb-code">{children}</code>;
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
