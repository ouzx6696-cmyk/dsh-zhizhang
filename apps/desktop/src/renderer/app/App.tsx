import { COPY as viewCopy } from "../../../../../packages/ui/src/copy.js";
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/600.css";
import "@fontsource/noto-serif-sc/400.css";
import "@fontsource/noto-serif-sc/600.css";
import "../../../../../packages/ui/src/components.css";
import "../../../../../packages/ui/src/tokens.css";
import "../../../../../packages/workbench/src/client/styles.css";
import "../../desktop.css";
import { LoaderCircle } from "lucide-react";
import { NoticeStack } from "../../../../../packages/ui/src/notify";
import { setConfirm } from "../../../../../packages/workbench/src/client/shared/confirm.js";
import { scopeId, type Focus, type Target } from "../../context";
import { useDesktopController } from "./useDesktopController";
import { desktopStore, useDesktopSelector } from "../state/store";
import { askConfirm } from "../state/confirm";
import { workspaceScope } from "../state/navigation";
import { TopBar } from "../features/topbar/TopBar";
import { AgentPanel } from "../features/agent/AgentPanel";
import { Workspace } from "../features/workspace/Workspace";
import { CommandPalette } from "../features/palette/CommandPalette";
import { ConfirmDialog } from "../features/confirm/ConfirmDialog";
import { RootErrorBoundary, reportUnhandledRejection } from "./crash";

const set = desktopStore.set;

// 设置、首次引导与设计预览不在启动首屏，按需加载以缩小入口包。
const Settings = lazy(() =>
  import("../features/settings/SettingsDialog").then((module) => ({ default: module.Settings })),
);
const Onboarding = lazy(() =>
  import("../features/onboarding/Onboarding").then((module) => ({ default: module.Onboarding })),
);
const DesignPreview = lazy(() =>
  import("../features/settings/DesignPreview").then((module) => ({
    default: module.DesignPreview,
  })),
);

const WorkflowPanel = lazy(() =>
  import("../features/workflow/WorkflowPanel").then((module) => ({
    default: module.WorkflowPanel,
  })),
);

function App() {
  const actions = useDesktopController();
  const [workflowOpen, setWorkflowOpen] = useState(false);
  // 工作台里的确认（放弃修改、删除等）统一走桌面确认框，不再弹原生 window.confirm。
  useEffect(() => setConfirm(askConfirm), []);
  const system = useDesktopSelector((state) => state.system);
  const view = useDesktopSelector((state) => state.view);
  const tab = useDesktopSelector((state) => state.tab);
  const drawer = useDesktopSelector((state) => state.drawer);
  const workspaceKey = useDesktopSelector((state) => state.workspaceKey);
  const settingsOpen = useDesktopSelector((state) => state.settingsOpen);
  const onboarding = useDesktopSelector((state) => state.onboarding);
  const palette = useDesktopSelector((state) => state.palette);
  const focus = useDesktopSelector((state) => state.focus);
  const { fail } = actions;
  const agent = useMemo(() => <AgentPanel actions={actions} />, [actions]);
  const setTab = useCallback((next: string) => set({ tab: next }), []);
  const setDrawer = useCallback((open: boolean) => set({ drawer: open }), []);
  const onView = useCallback(
    (next: string) => void actions.changeView(next).catch(fail),
    [actions, fail],
  );
  const onReview = useCallback(() => void actions.deliver("review").catch(fail), [actions, fail]);
  const onNewChapter = useCallback(
    () => void actions.sendText(viewCopy.appText2, { intent: "plan" }).catch(fail),
    [actions, fail],
  );
  const onTarget = useCallback(
    (next: Target & { focus?: Focus }) => void actions.selectSnapshot(next).catch(fail),
    [actions, fail],
  );
  const openWorkflow = useCallback(() => setWorkflowOpen(true), []);
  const closeWorkflow = useCallback(() => setWorkflowOpen(false), []);
  const closeSettings = useCallback(() => set({ settingsOpen: false }), []);
  const onSettingsSaved = useCallback(async () => {
    await actions.syncState();
    const selected = desktopStore.get().selected;
    if (selected) await actions.loadView(selected);
    actions.refreshWorkspace();
  }, [actions]);
  if (!system)
    return (
      <div className="startup">
        <LoaderCircle className="spin" />
        {viewCopy.appText1}
      </div>
    );
  return (
    <div className="writer-desktop wb-scope">
      <TopBar actions={actions} onWorkflow={openWorkflow} />
      {system.target ? (
        <Workspace
          key={workspaceScope(system.target) + workspaceKey}
          target={system.target}
          view={view}
          agent={agent}
          tab={tab}
          setTab={setTab}
          onView={onView}
          onReview={onReview}
          onNewChapter={onNewChapter}
          drawer={drawer}
          setDrawer={setDrawer}
          readOnly={system.access?.readOnly}
          onContext={actions.setContext}
          onTarget={onTarget}
          onSourceEditState={actions.trackSourceEdit}
          onMethodEditState={actions.trackMethodEdit}
        />
      ) : (
        <div className="studio-empty">
          <h1>{viewCopy.appText3}</h1>
          <p>{viewCopy.appText4}</p>
          <button className="primary" onClick={() => set({ wizardStep: 0, onboarding: true })}>
            {viewCopy.appText5}
          </button>
        </div>
      )}
      <Suspense fallback={null}>
        {workflowOpen && system.target && (
          <WorkflowPanel
            key={scopeId(system.target)}
            target={system.target}
            focus={focus}
            engine={system.engine}
            onClose={closeWorkflow}
            onNavigate={actions.jump}
          />
        )}
        {settingsOpen && (
          <Settings
            state={system}
            onClose={closeSettings}
            onSaved={onSettingsSaved}
            canRestart={actions.canRestart}
            onWorkspace={actions.chooseWorkspace}
            onImport={actions.importRoot}
          />
        )}
        {onboarding === true && <Onboarding actions={actions} />}
      </Suspense>
      {palette && <CommandPalette actions={actions} />}
      <ConfirmDialog />
      <NoticeStack label={viewCopy.notices} />
    </div>
  );
}

const search = new URLSearchParams(window.location.search);
const preview = import.meta.env.DEV && search.has("ui-preview");
// 主进程按已保存主题在地址里带上 theme：syncState 返回前的首帧就用对的配色。
const initialTheme = search.get("theme");
if (initialTheme === "dark" || initialTheme === "light")
  document.documentElement.dataset.theme = initialTheme;
const root = document.getElementById("root");
if (!root) throw new Error("找不到界面挂载点 #root，无法启动界面");
window.addEventListener("unhandledrejection", reportUnhandledRejection);
createRoot(root).render(
  <RootErrorBoundary>
    {preview ? (
      <Suspense fallback={null}>
        <DesignPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </RootErrorBoundary>,
);
