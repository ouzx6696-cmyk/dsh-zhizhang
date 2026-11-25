import React from "react";
import { X } from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { dismissNotice, useLatestNotice } from "@zhizhang/ui/notify";
import { Button, type MenuItem } from "@zhizhang/ui/primitives";
import type { TargetItem } from "../../../shared/views";
import { select, startCreate, takeOverWorkspace } from "../../state/controller";
import { sameTarget, useDesktop } from "../../state/store";
import { run } from "../../format";

export function targetMenu(targets: TargetItem[], current: TargetItem | null): MenuItem[] {
  const works = targets.filter((t) => t.kind === "work");
  const articles = targets.filter((t) => t.kind === "article");
  const item = (t: TargetItem): MenuItem => ({
    id: t.target.mode + t.target.path,
    label: (
      <span
        className="zz-target-item"
        data-testid="target-item"
        data-mode={t.target.mode}
        data-current={sameTarget(t.target, current?.target)}
      >
        {t.label}
      </span>
    ),
    onSelect: () => run(() => select(t.target)),
  });
  return [
    { id: "h-works", label: C.topbar.works, heading: true },
    ...works.map(item),
    { id: "new-work", label: C.create.newWork, onSelect: () => startCreate("fanqie") },
    { id: "sep", label: "", separator: true },
    { id: "h-articles", label: C.topbar.articles, heading: true },
    ...articles.map(item),
    { id: "new-article", label: C.create.newArticle, onSelect: () => startCreate("toutiao") },
  ];
}

export function QuietFooter() {
  const latest = useLatestNotice();
  const lastSavedAt = useDesktop((s) => s.lastSavedAt);
  const workspace = useDesktop((s) => s.workspace);

  if (workspace?.readonly) {
    return (
      <div
        className="zz-rail__status zz-rail__status--warn"
        role="status"
        data-testid="readonly-banner"
      >
        <span>{C.topbar.readonly(workspace.owner ?? "")}</span>
        {workspace.owner ? (
          <Button
            size="xs"
            variant="soft"
            data-testid="take-over"
            onClick={() => run(takeOverWorkspace)}
          >
            {C.topbar.takeOver}
          </Button>
        ) : null}
      </div>
    );
  }

  if (latest) {
    const tone = latest.tone === "danger" ? "bad" : latest.tone === "warning" ? "warn" : "ok";
    return (
      <div
        className="zz-rail__status"
        data-tone={tone}
        role={latest.tone === "danger" || latest.tone === "warning" ? "alert" : "status"}
        aria-live="polite"
      >
        <span className="zz-rail__status-dot" aria-hidden="true" />
        <span className="zz-rail__status-text" title={latest.detail || latest.text}>
          {latest.text}
        </span>
        {latest.tone === "danger" || latest.tone === "warning" ? (
          <button
            type="button"
            className="zz-rail__status-close"
            aria-label={COPY.close}
            onClick={() => dismissNotice(latest.id)}
          >
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="zz-rail__status" data-testid="local-save-status">
      <span className="zz-rail__status-dot" aria-hidden="true" />
      <span className="zz-rail__status-text">
        {lastSavedAt ? C.rail.savedLocal(lastSavedAt) : C.rail.localReady}
      </span>
    </div>
  );
}
