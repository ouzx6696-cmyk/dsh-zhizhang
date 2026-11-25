import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Skeleton } from "@zhizhang/ui/primitives";
import { PREF, readPref, writePref } from "@zhizhang/workbench/client";
import type { TargetItem } from "../../../shared/views";
import { useDesktop } from "../../state/store";
import { CenterBar } from "../topbar/CenterBar";
import { RightDock } from "./RightDock";
import { StudioDashboard } from "./StudioDashboard";

// 写作区与设定集中心按需懒加载：入口只带外壳。
const FanqieWorkspace = lazy(() =>
  import("./FanqieWorkspace").then((m) => ({ default: m.FanqieWorkspace })),
);
const ToutiaoWorkspace = lazy(() =>
  import("./ToutiaoWorkspace").then((m) => ({ default: m.ToutiaoWorkspace })),
);
const BibleCenter = lazy(() =>
  import("../bible/BibleCenter").then((m) => ({ default: m.BibleCenter })),
);

const DOCK_MIN = 312;
const DOCK_MAX = 520;
const DOCK_DEFAULT = 344;
const DOCK_STEP = 16;

function clampDock(value: number): number {
  return Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, value)));
}

/** 右栏宽度：默认 344px，拖左缘或用方向键调整，记在本机偏好里。 */
function useDockWidth(): [number, (next: number) => void] {
  const [width, setWidth] = useState(() => {
    const saved = Number(readPref(PREF.dockWidth));
    return Number.isFinite(saved) && saved > 0 ? clampDock(saved) : DOCK_DEFAULT;
  });
  const update = useCallback((next: number) => setWidth(clampDock(next)), []);
  useEffect(() => {
    const timer = setTimeout(() => writePref(PREF.dockWidth, String(width)), 200);
    return () => clearTimeout(timer);
  }, [width]);
  return [width, update];
}

function DockHandle({ width, onResize }: { width: number; onResize: (next: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);
  return (
    <div
      className="zz-dock-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={C.dock.resize}
      aria-valuemin={DOCK_MIN}
      aria-valuemax={DOCK_MAX}
      aria-valuenow={width}
      tabIndex={0}
      data-active={active}
      data-testid="dock-resize"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        setActive(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onResize(drag.current.width + (drag.current.x - event.clientX));
      }}
      onPointerUp={() => {
        drag.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onDoubleClick={() => onResize(DOCK_DEFAULT)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(width + DOCK_STEP);
        else if (event.key === "ArrowRight") onResize(width - DOCK_STEP);
        else if (event.key === "Home") onResize(DOCK_MAX);
        else if (event.key === "End") onResize(DOCK_MIN);
        else return;
        event.preventDefault();
      }}
    />
  );
}

function WorkspaceFallback() {
  return (
    <div className="zz-workspace-fallback" aria-busy="true">
      <Skeleton lines={8} />
    </div>
  );
}

/** 写作台（三栏之中栏 + 344px 右栏双卡）：中栏顶部极简面包屑条 + 可折叠 D3 进度条 + 浮起稿纸区。 */
export function Studio({ item }: { item: TargetItem }) {
  const dockOpen = useDesktop((state) => state.dockOpen);
  const zenMode = useDesktop((state) => state.zenMode);
  const view = useDesktop((state) => state.view);
  const readonly = useDesktop((state) => Boolean(state.workspace?.readonly));
  const [width, setWidth] = useDockWidth();
  const showDock = dockOpen && !zenMode;
  const style = { "--zz-dock-width": `${width}px` } as React.CSSProperties;
  return (
    <div
      className="zz-studio"
      data-dock={showDock ? "open" : "closed"}
      data-zen={zenMode ? "on" : "off"}
      style={style}
    >
      <main className="zz-studio__main" data-testid="workspace" data-mode={item.target.mode}>
        <CenterBar item={item} />
        {!zenMode && view === "writing" ? <StudioDashboard item={item} /> : null}
        <div className="zz-studio__body">
          <Suspense fallback={<WorkspaceFallback />}>
            {view === "bible" && item.target.mode === "fanqie" ? (
              <BibleCenter target={item.target} />
            ) : item.target.mode === "fanqie" ? (
              <FanqieWorkspace target={item.target} readonly={readonly} />
            ) : (
              <ToutiaoWorkspace target={item.target} readonly={readonly} />
            )}
          </Suspense>
        </div>
      </main>
      {showDock ? (
        <div className="zz-studio__dock">
          <DockHandle width={width} onResize={setWidth} />
          <RightDock target={item.target} />
        </div>
      ) : null}
    </div>
  );
}
