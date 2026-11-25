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
const WIDE = "(min-width: 1180px)";

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
 * 柔和纸面 C2 右栏（344px，两张静谧 --zz-surface 浮卡）：
 * 桌面宽屏（≥1180px）默认上下双卡同屏：上方流水线卡 + 下方只读助手卡（占满剩余高度）；
 * 顶部轻量标签可切换「本章/设定集」参考卡。
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
              size="xs"
              variant="ghost"
              pressed={splitPref}
              data-testid="dock-split"
              icon={<Rows2 size={14} />}
              onClick={() => {
                writePref(PREF.dockSplit, splitPref ? "off" : "on");
                set({ dockSplit: !splitPref });
              }}
            />
          ) : null}
          <IconButton
            label={C.dock.close}
            size="xs"
            variant="ghost"
            icon={<PanelRightClose size={14} />}
            onClick={() => set({ dockOpen: false })}
          />
        </div>
      </div>
      {split ? (
        <div {...tabPanelProps(base, "assistant", shown)} className="zz-dock__split">
          <section
            className="zz-dock__card zz-dock__card--pipeline"
            aria-label={C.dock.pipelineHead}
          >
            <div className="zz-dock__card-body">
              <WorkflowPanel key={target.path} target={target} compact />
            </div>
          </section>
          <section
            className="zz-dock__card zz-dock__card--assistant"
            aria-label={C.dock.assistantHead}
          >
            <div className="zz-dock__card-body zz-dock__card-body--fill">
              <AgentPanel target={target} />
            </div>
          </section>
        </div>
      ) : (
        <>
          <div {...tabPanelProps(base, "assistant", shown)} className="zz-dock__panel">
            <section className="zz-dock__card zz-dock__card--fill">
              <div className="zz-dock__card-body zz-dock__card-body--fill">
                <AgentPanel target={target} />
              </div>
            </section>
          </div>
          <div {...tabPanelProps(base, "pipeline", shown)} className="zz-dock__panel">
            {shown === "pipeline" ? (
              <section className="zz-dock__card zz-dock__card--fill">
                <div className="zz-dock__card-body">
                  <WorkflowPanel key={target.path} target={target} />
                </div>
              </section>
            ) : null}
          </div>
        </>
      )}
      <div {...tabPanelProps(base, "chapter", shown)} className="zz-dock__panel">
        {shown === "chapter" ? (
          <section className="zz-dock__card zz-dock__card--fill">
            <div className="zz-dock__card-body">
              <ChapterPane target={target} />
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
