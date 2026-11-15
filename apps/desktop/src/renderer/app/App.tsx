import React, { Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/noto-serif-sc/400.css";
import "@fontsource/noto-serif-sc/600.css";
import "@zhizhang/ui/components.css";
import "@zhizhang/workbench/styles.css";
import "../styles/index.css";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { NoticeStack } from "@zhizhang/ui/notify";
import { Button, Spinner } from "@zhizhang/ui/primitives";
import { setConfirm } from "@zhizhang/workbench/client";
import { askConfirm } from "../state/confirm";
import { boot, startCreate } from "../state/controller";
import { subscribeDesktopEvents } from "../state/events";
import { desktopStore, useDesktop } from "../state/store";
import { errorText, notifyError } from "../format";
import { ConfirmDialog } from "../features/confirm/ConfirmDialog";
import { TopBar } from "../features/topbar/TopBar";
import { Studio } from "../features/workspace/Studio";
import { NewTargetDialog } from "../features/create/NewTargetDialog";
import { RootErrorBoundary, reportUnhandledRejection } from "./crash";
import { useAppearance } from "./useAppearance";
import { useShortcuts } from "./useShortcuts";

const Settings = lazy(() => import("../features/settings/SettingsDialog").then((m) => ({ default: m.SettingsDialog })));
const Onboarding = lazy(() => import("../features/onboarding/Onboarding").then((m) => ({ default: m.Onboarding })));

function Welcome() {
  const configured = useDesktop((state) => Boolean(state.workspace?.configured));
  return (
    <div className="zz-empty-page" data-testid="welcome">
      <h1>{C.shell.welcomeTitle}</h1>
      <p>{configured ? C.shell.welcomePick : C.shell.welcomeSetup}</p>
      {configured ? (
        <div className="zz-row">
          <Button variant="primary" data-testid="welcome-new-work" onClick={() => startCreate("fanqie")}>
            {C.create.newWork}
          </Button>
          <Button data-testid="welcome-new-article" onClick={() => startCreate("toutiao")}>
            {C.create.newArticle}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const bootState = useDesktop((state) => state.boot);
  const bootError = useDesktop((state) => state.bootError);
  const selected = useDesktop((state) => state.selected);
  const appearance = useDesktop((state) => state.settings?.appearance);
  const settingsOpen = useDesktop((state) => state.settingsOpen);
  const onboarding = useDesktop((state) => state.onboarding);
  const creating = useDesktop((state) => state.creating);
  useAppearance(appearance);
  useShortcuts();
  useEffect(() => setConfirm(askConfirm), []);
  useEffect(() => {
    const unsubscribe = subscribeDesktopEvents();
    boot().catch((error: unknown) => {
      notifyError(error);
      desktopStore.set({ boot: "error", bootError: errorText(error) });
    });
    return unsubscribe;
  }, []);

  if (bootState === "loading")
    return (
      <div className="zz-desktop zz-startup" data-testid="startup">
        <Spinner label={C.shell.starting} />
        <span>{C.shell.starting}</span>
      </div>
    );
  return (
    <div className="zz-desktop" data-testid="app" data-mode={selected?.target.mode ?? "none"}>
      <TopBar />
      {bootState === "error" ? (
        <div className="zz-empty-page" role="alert" data-testid="boot-error">
          <h1>{C.shell.bootFailed}</h1>
          <p>{bootError}</p>
        </div>
      ) : selected ? (
        <Studio key={selected.target.mode + selected.target.path} item={selected} />
      ) : (
        <Welcome />
      )}
      <Suspense fallback={null}>
        {settingsOpen ? <Settings /> : null}
        {onboarding ? <Onboarding /> : null}
      </Suspense>
      {creating ? <NewTargetDialog kind={creating} /> : null}
      <ConfirmDialog />
      <NoticeStack label={C.shell.notices} />
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  window.addEventListener("unhandledrejection", reportUnhandledRejection);
  createRoot(root).render(
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>,
  );
}
