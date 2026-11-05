import type { WorkspaceContext } from "../../renderer-contracts";
import { COPY as viewCopy } from "../../../../../packages/ui/src/copy.js";
import { DesignPreview } from "../features/settings/DesignPreview";
import React from "react";
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
import { Settings } from "../features/settings/SettingsDialog";
import { Onboarding } from "../features/onboarding/Onboarding";
import { CommandPalette } from "../features/palette/CommandPalette";
import { ConfirmDialog } from "../features/confirm/ConfirmDialog";

function App() {
  const app = useDesktopController();
  const { system, state, set } = app;
  const onContext = React.useCallback((context: WorkspaceContext) => set({context}), [set]);
  if (!system)
    return (
      <div className="startup">
        <LoaderCircle className="spin" />
        {viewCopy.appText1}
      </div>
    );
  return (
    <div className="writer-desktop wb-scope">
      <TopBar app={app} />
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
      {state.palette && <CommandPalette app={app} />}
      <ConfirmDialog />
    </div>
  );
}

const preview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("ui-preview");
const root = document.getElementById("root");
if (!root) throw new Error("找不到界面挂载点 #root，无法启动界面");
createRoot(root).render(preview ? <DesignPreview /> : <App />);
