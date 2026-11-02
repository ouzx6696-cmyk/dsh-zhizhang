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
  if (!system)
    return (
      <div className="startup">
        <LoaderCircle className="spin" />
        正在打开写作 Agent…
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
              .sendText("【写作台】为本书规划下一章。先确认标题、冲突和章纲，不自动写正文。", {
                intent: "plan",
              })
              .catch(app.fail)
          }
          drawer={state.drawer}
          setDrawer={(drawer) => set({ drawer })}
          readOnly={system.access?.readOnly}
          onContext={(context) => set({ context })}
          onTarget={(next) => void app.selectSnapshot(next).catch(app.fail)}
          onSourceEditState={app.trackSourceEdit}
          onMethodEditState={app.trackMethodEdit}
        />
      ) : (
        <div className="studio-empty">
          <h1>你的下一篇，从这里开始</h1>
          <p>先连接模型并选择写作文件夹，小说与头条会统一整理在本地。</p>
          <button className="primary" onClick={() => set({ wizardStep: 0, onboarding: true })}>
            开始设置
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
createRoot(document.getElementById("root")!).render(preview ? <DesignPreview /> : <App />);
