import type { WorkspaceContext } from "../../renderer-contracts";
import { COPY as viewCopy } from "../../../../../packages/ui/src/copy.js";
import React, { Suspense, lazy } from "react";
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
import { scopeId } from "../../context";
import { useDesktopController } from "./useDesktopController";
import { TopBar } from "../features/topbar/TopBar";
import { AgentPanel } from "../features/agent/AgentPanel";
import { Workspace } from "../features/workspace/Workspace";
import { CommandPalette } from "../features/palette/CommandPalette";
import { ConfirmDialog } from "../features/confirm/ConfirmDialog";

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
  const [workflowOpen, setWorkflowOpen] = React.useState(false);
  const app = useDesktopController();
  const { system, state, set } = app;
  const onContext = React.useCallback((context: WorkspaceContext) => set({ context }), [set]);
  if (!system)
    return (
      <div className="startup">
        <LoaderCircle className="spin" />
        {viewCopy.appText1}
      </div>
    );
  return (
    <div className="writer-desktop wb-scope">
      <TopBar app={app} onWorkflow={() => setWorkflowOpen(true)} />
      {system.target ? (
        <Workspace
          key={scopeId({ ...system.target, article: undefined }) + state.workspaceKey}
          target={system.target}
          view={state.view}
          agent={<AgentPanel app={app} />}
          tab={state.tab}
          setTab={(tab) => set({ tab })}
          onView={app.changeView}
          onReview={() => void app.deliver("review").catch(app.fail)}
          onNewChapter={() =>
            void app
              .sendText(viewCopy.appText2, {
                intent: "plan",
              })
              .catch(app.fail)
          }
          drawer={state.drawer}
          setDrawer={(drawer) => set({ drawer })}
          readOnly={system.access?.readOnly}
          onContext={onContext}
          onTarget={(next) => void app.selectSnapshot(next).catch(app.fail)}
          onSourceEditState={app.trackSourceEdit}
          onMethodEditState={app.trackMethodEdit}
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
            focus={app.focus}
            engine={system.engine}
            onClose={() => setWorkflowOpen(false)}
            onNavigate={app.jump}
          />
        )}
        {state.settingsOpen && (
          <Settings
            state={system}
            onClose={() => set({ settingsOpen: false })}
            onSaved={async () => {
              await app.syncState();
              if (app.selected) await app.loadView(app.selected);
              app.refreshWorkspace();
            }}
            canRestart={app.canRestart}
            onWorkspace={app.chooseWorkspace}
            onImport={app.importRoot}
          />
        )}
        {state.onboarding === true && <Onboarding app={app} />}
      </Suspense>
      {state.palette && <CommandPalette app={app} />}
      <ConfirmDialog />
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
createRoot(root).render(
  preview ? (
    <Suspense fallback={null}>
      <DesignPreview />
    </Suspense>
  ) : (
    <App />
  ),
);
