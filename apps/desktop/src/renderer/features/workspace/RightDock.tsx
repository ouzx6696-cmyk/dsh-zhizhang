import React, { useEffect, useId, useState } from "react";
import { PanelRightClose, Rows2 } from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { IconButton, Tabs, tabPanelProps } from "@zhizhang/ui/primitives";
import { statusLabel } from "@zhizhang/ui/status";
import { PREF, readPref, writePref } from "@zhizhang/workbench/client";
import type { Target } from "../../../shared/views";
import { AgentPanel } from "../agent/AgentPanel";
import { BiblePane } from "../workflow/BiblePane";
import { WorkflowPanel } from "../workflow/WorkflowPanel";
import { desktopStore, useDesktop, type DockTab } from "../../state/store";

const set = desktopStore.set;
const WIDE = "(min-width: 1600px)";

function isDockTab(value: string): value is DockTab {
  return value === "assistant" || value === "pipeline" || value === "chapter";
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const media = window.matchMedia(WIDE);
    const onChange = () => setWide(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return wide;
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
            <dd data-testid="chapter-pane-current">
              {focus.title || focus.chapter || C.dock.none}
            </dd>
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

/**
 * 右栏：助手 / 流水线 / 本章。≥1600px 且开启分屏时，流水线在上、助手在下同屏显示，
 * 标签收成“助手 · 流水线”与“本章”两项。
 */
export function RightDock({ target }: { target: Target }) {
  const base = useId();
  const tab = useDesktop((s) => s.dockTab);
  const splitPref = useDesktop((s) => s.dockSplit);
  const wide = useWide();
  const split = wide && splitPref;

  useEffect(() => {
    const saved = readPref(PREF.dockSplit);
    if (saved) set({ dockSplit: saved !== "off" });
  }, []);

  const chapterLabel = target.mode === "toutiao" ? C.dock.articleTab : COPY["shell.tab.chapter"];
  const items = split
    ? [
        { id: "assistant", label: C.dock.splitTab },
        { id: "chapter", label: chapterLabel },
      ]
    : [
        { id: "assistant", label: COPY["shell.tab.assistant"] },
        { id: "pipeline", label: COPY["shell.tab.pipeline"] },
        { id: "chapter", label: chapterLabel },
      ];
  const shown: DockTab = split && tab === "pipeline" ? "assistant" : tab;
  return (
    <aside
      className="zz-dock"
      data-testid="right-dock"
      data-split={split ? "on" : "off"}
      aria-label={C.dock.label}
    >
      <div className="zz-dock__tabs">
        <Tabs
          id={base}
          label={C.dock.label}
          items={items}
          value={shown}
          testId="dock-tab"
          onChange={(next) => {
            if (isDockTab(next)) set({ dockTab: next });
          }}
        />
        <div className="zz-dock__tools">
          {wide ? (
            <IconButton
              label={C.dock.split}
              size="sm"
              pressed={splitPref}
              data-testid="dock-split"
              icon={<Rows2 size={15} />}
              onClick={() => {
                writePref(PREF.dockSplit, splitPref ? "off" : "on");
                set({ dockSplit: !splitPref });
              }}
            />
          ) : null}
          <IconButton
            label={C.dock.close}
            size="sm"
            icon={<PanelRightClose size={15} />}
            onClick={() => set({ dockOpen: false })}
          />
        </div>
      </div>
      {split ? (
        <div {...tabPanelProps(base, "assistant", shown)} className="zz-dock__split">
          <section
            className="zz-dock__pane zz-dock__pane--pipeline"
            aria-label={C.dock.pipelineHead}
          >
            <h2 className="zz-dock__pane-head">{C.dock.pipelineHead}</h2>
            <div className="zz-dock__pane-body">
              <WorkflowPanel key={target.path} target={target} />
            </div>
          </section>
          <section
            className="zz-dock__pane zz-dock__pane--assistant"
            aria-label={C.dock.assistantHead}
          >
            <h2 className="zz-dock__pane-head">{C.dock.assistantHead}</h2>
            <div className="zz-dock__pane-body">
              <AgentPanel target={target} />
            </div>
          </section>
        </div>
      ) : (
        <>
          <div {...tabPanelProps(base, "assistant", shown)} className="zz-dock__panel">
            <AgentPanel target={target} />
          </div>
          <div {...tabPanelProps(base, "pipeline", shown)} className="zz-dock__panel">
            {shown === "pipeline" ? <WorkflowPanel key={target.path} target={target} /> : null}
          </div>
        </>
      )}
      <div {...tabPanelProps(base, "chapter", shown)} className="zz-dock__panel">
        {shown === "chapter" ? <ChapterPane target={target} /> : null}
      </div>
    </aside>
  );
}
