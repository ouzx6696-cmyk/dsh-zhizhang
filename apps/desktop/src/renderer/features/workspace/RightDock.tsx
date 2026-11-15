import React, { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { COPY } from "@zhizhang/ui/copy";
import { TabList, tabPanelProps } from "@zhizhang/ui/tabs";
import { PanelRightClose, Rows2 } from "lucide-react";
import { DESKTOP_COPY as viewCopy } from "../../../shared/copy";

const DOCK_WIDTH_MIN = 300;
const DOCK_WIDTH_MAX = 720;
const DOCK_WIDTH_DEFAULT = 392;
const SPLIT_RATIO_MIN = 0.25;
const SPLIT_RATIO_MAX = 0.75;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export interface RightDockProps {
  tab: string;
  setTab: (tab: string) => void;
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  split: boolean;
  onToggleSplit: () => void;
  mode: "fanqie" | "toutiao";
  agent: ReactNode;
  pipeline?: ReactNode;
  inspector: ReactNode;
  methodsPane: ReactNode;
}

export function RightDock({
  tab,
  setTab,
  drawer,
  setDrawer,
  split,
  onToggleSplit,
  mode,
  agent,
  pipeline,
  inspector,
  methodsPane,
}: RightDockProps) {
  const tabsId = React.useId();
  const isFourCol = useMediaQuery("(min-width: 1600px)");
  const [dockWidth, setDockWidth] = useState<number>(DOCK_WIDTH_DEFAULT);
  const [splitRatio, setSplitRatio] = useState<number>(0.5);

  const startWidthDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        DOCK_WIDTH_MAX,
        Math.max(DOCK_WIDTH_MIN, startWidth + (startX - moveEvent.clientX)),
      );
      setDockWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [dockWidth]);

  const startSplitDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (moveEvent: PointerEvent) => {
      if (rect.height <= 0) return;
      const ratio = (moveEvent.clientY - rect.top) / rect.height;
      setSplitRatio(Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const tabs = [
    { id: "agent", label: COPY["shell.tab.assistant"] },
    { id: "pipeline", label: COPY["shell.tab.pipeline"] },
    {
      id: "chapter",
      label: mode === "toutiao" ? viewCopy.workspaceLayoutText4 : COPY["shell.tab.chapter"],
    },
    { id: "methods", label: viewCopy.pfButton },
  ];

  const dockStyle = {
    "--right-dock-width": `${dockWidth}px`,
    "--right-dock-split-top": `${Math.round(splitRatio * 100)}%`,
  } as React.CSSProperties;

  return (
    <>
      <aside
        className={"studio-sidebar right-dock " + (drawer ? "open" : "")}
        style={dockStyle}
        data-four-col={isFourCol ? "true" : "false"}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          className="right-dock-resizer"
          onPointerDown={startWidthDrag}
        />
        <div className="studio-tabs">
          <TabList
            id={tabsId}
            label={viewCopy.sidebarTabs}
            items={tabs}
            value={tab}
            onChange={setTab}
            className="studio-tablist"
          />
          <button
            type="button"
            className="icon-button"
            aria-pressed={split}
            aria-label={split ? viewCopy.rightDockTabs : viewCopy.rightDockSplit}
            title={split ? viewCopy.rightDockTabs : viewCopy.rightDockSplit}
            onClick={onToggleSplit}
          >
            <Rows2 size={15} />
          </button>
          <button
            type="button"
            className="drawer-close icon-button"
            aria-label={viewCopy.workspaceLayoutText7}
            onClick={() => setDrawer(false)}
          >
            <PanelRightClose size={16} />
          </button>
        </div>
        {split ? (
          <div className="studio-side-body right-dock-split">
            <div
              className="right-dock-pane agent-slot"
              style={{ flex: `0 0 var(--right-dock-split-top, 50%)` }}
            >
              {agent}
            </div>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="调整分屏比例"
              className="right-dock-split-resizer"
              onPointerDown={startSplitDrag}
            />
            <div className="right-dock-pane">{pipeline}</div>
          </div>
        ) : (
          <div className="studio-side-body" data-tab={tab}>
            <div {...tabPanelProps(tabsId, "agent", tab)} className="agent-slot">
              {agent}
            </div>
            <div {...tabPanelProps(tabsId, "pipeline", tab)} className="agent-slot">
              {tab === "pipeline" && pipeline}
            </div>
            <div {...tabPanelProps(tabsId, "chapter", tab)} className="decision-panel">
              {tab === "chapter" && inspector}
            </div>
            <div {...tabPanelProps(tabsId, "methods", tab)} className="methods-slot">
              {methodsPane}
            </div>
          </div>
        )}
      </aside>
      {isFourCol && (
        <aside className="studio-sidebar studio-inspector-col" aria-label="章节审读与方法">
          <div className="decision-panel">{inspector}</div>
        </aside>
      )}
    </>
  );
}
