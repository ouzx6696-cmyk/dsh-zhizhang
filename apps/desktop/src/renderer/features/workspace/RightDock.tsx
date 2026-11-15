import React, { useId } from "react";
import { PanelRightClose } from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { IconButton, Tabs, tabPanelProps } from "@zhizhang/ui/primitives";
import { statusLabel } from "@zhizhang/ui/status";
import type { Target } from "../../../shared/views";
import { AgentPanel } from "../agent/AgentPanel";
import { BiblePane } from "../workflow/BiblePane";
import { WorkflowPanel } from "../workflow/WorkflowPanel";
import { desktopStore, useDesktop, type DockTab } from "../../state/store";

const set = desktopStore.set;

function isDockTab(value: string): value is DockTab {
  return value === "assistant" || value === "pipeline" || value === "chapter";
}

function ChapterPane({ target }: { target: Target }) {
  const focus = useDesktop((s) => s.focus);
  const selected = useDesktop((s) => s.selected);
  const chapters = useDesktop((s) => s.chapters.length);
  return (
    <div className="zz-chapter-pane" data-testid="chapter-pane">
      <dl className="zz-facts">
        <div>
          <dt>{target.mode === "fanqie" ? C.dock.work : C.dock.article}</dt>
          <dd>{selected?.label}</dd>
        </div>
        {target.mode === "fanqie" ? (
          <div>
            <dt>{C.dock.chapter}</dt>
            <dd data-testid="chapter-pane-current">{focus.title || focus.chapter || C.dock.none}</dd>
          </div>
        ) : (
          <div>
            <dt>{C.fanqie.status}</dt>
            <dd>{statusLabel("toutiao", selected?.status)}</dd>
          </div>
        )}
      </dl>
      {target.mode === "fanqie" ? <BiblePane work={target.path} chapters={chapters} /> : null}
    </div>
  );
}

export function RightDock({ target }: { target: Target }) {
  const base = useId();
  const tab = useDesktop((s) => s.dockTab);
  const items = [
    { id: "assistant", label: COPY["shell.tab.assistant"] },
    { id: "pipeline", label: COPY["shell.tab.pipeline"] },
    { id: "chapter", label: target.mode === "toutiao" ? C.dock.articleTab : COPY["shell.tab.chapter"] },
  ];
  return (
    <aside className="zz-dock" data-testid="right-dock" aria-label={C.dock.label}>
      <div className="zz-dock__tabs">
        <Tabs
          id={base}
          label={C.dock.label}
          items={items}
          value={tab}
          testId="dock-tab"
          onChange={(next) => {
            if (isDockTab(next)) set({ dockTab: next });
          }}
        />
        <IconButton label={C.dock.close} size="sm" icon={<PanelRightClose size={15} />} onClick={() => set({ dockOpen: false })} />
      </div>
      <div {...tabPanelProps(base, "assistant", tab)} className="zz-dock__panel">
        <AgentPanel target={target} />
      </div>
      <div {...tabPanelProps(base, "pipeline", tab)} className="zz-dock__panel">
        {tab === "pipeline" ? <WorkflowPanel target={target} /> : null}
      </div>
      <div {...tabPanelProps(base, "chapter", tab)} className="zz-dock__panel">
        {tab === "chapter" ? <ChapterPane target={target} /> : null}
      </div>
    </aside>
  );
}
