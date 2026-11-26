import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@zhizhang/ui/components.css";
import "@zhizhang/workbench/styles.css";
import "../styles/index.css";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Brand, Skeleton, Spinner } from "@zhizhang/ui/primitives";
import { setConfirm } from "@zhizhang/workbench/client";
import { askConfirm } from "../state/confirm";
import { boot } from "../state/controller";
import { subscribeDesktopEvents } from "../state/events";
import { desktopStore, useDesktop } from "../state/store";
import { checkWebAuthStatus } from "../state/web-bridge";
import { errorText, notifyError } from "../format";
import { WebPasscodeGate } from "../features/auth/WebPasscodeGate";
import { ConfirmDialog } from "../features/confirm/ConfirmDialog";
import { ProjectHub } from "../features/hub/ProjectHub";
import { CommandPalette } from "../features/topbar/CommandPalette";
import { LeftRail } from "../features/topbar/LeftRail";
import { RootErrorBoundary, reportUnhandledRejection } from "./crash";
import { useAppearance } from "./useAppearance";
import { useShortcuts } from "./useShortcuts";

const Studio = lazy(() =>
  import("../features/workspace/Studio").then((m) => ({ default: m.Studio })),
);
const TechniqueWarehouse = lazy(() =>
  import("../features/library/TechniqueWarehouse").then((m) => ({
    default: m.TechniqueWarehouse,
  })),
);
const NewTargetDialog = lazy(() =>
  import("../features/create/NewTargetDialog").then((m) => ({ default: m.NewTargetDialog })),
);
const Settings = lazy(() =>
  import("../features/settings/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
void import("../styles/paper-fonts");

const Onboarding = lazy(() =>
  import("../features/onboarding/Onboarding").then((m) => ({ default: m.Onboarding })),
);

function StudioFallback() {
  return (
    <div className="zz-studio-fallback" aria-busy="true">
      <Skeleton lines={10} />
    </div>
  );
}

type AuthPhase = "checking" | "locked" | "ready";

function App() {
  const bootState = useDesktop((state) => state.boot);
  const bootError = useDesktop((state) => state.bootError);
  const selected = useDesktop((state) => state.selected);
  const view = useDesktop((state) => state.view);
  const zenMode = useDesktop((state) => state.zenMode);
  const appearance = useDesktop((state) => state.settings?.appearance);
  const settingsOpen = useDesktop((state) => state.settingsOpen);
  const onboarding = useDesktop((state) => state.onboarding);
  const creating = useDesktop((state) => state.creating);
  const [authPhase, setAuthPhase] = useState<AuthPhase>(() =>
    window.zhizhangBridge ? "ready" : "checking",
  );
  useAppearance(appearance);
  useShortcuts();
  useEffect(() => setConfirm(askConfirm), []);
  useEffect(() => {
    if (window.zhizhangBridge) return;
    let active = true;
    checkWebAuthStatus()
      .then((status) => {
        if (!active) return;
        setAuthPhase(status.required && !status.authenticated ? "locked" : "ready");
      })
      .catch(() => {
        if (active) setAuthPhase("ready");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (authPhase !== "ready") return;
    const unsubscribe = subscribeDesktopEvents();
    boot().catch((error: unknown) => {
      notifyError(error);
      desktopStore.set({ boot: "error", bootError: errorText(error) });
    });
    return unsubscribe;
  }, [authPhase]);

  if (authPhase === "locked") {
    return <WebPasscodeGate onUnlocked={() => setAuthPhase("ready")} />;
  }

  if (authPhase === "checking" || bootState === "loading")
    return (
      <div className="zz-desktop zz-startup" data-testid="startup">
        <Brand label={COPY["app.name"]} />
        <span className="zz-startup__text">
          <Spinner size="sm" label={C.shell.starting} />
          {C.shell.starting}
        </span>
      </div>
    );

  const showWarehouse = view === "warehouse";
  const showHub = view === "hub" || !selected;

  return (
    <div
      className="zz-desktop"
      data-testid="app"
      data-mode={selected?.target.mode ?? "none"}
      data-zen={zenMode ? "on" : "off"}
    >
      {!zenMode ? <LeftRail /> : null}
      <div className="zz-desktop__stage">
        {bootState === "error" ? (
          <div className="zz-empty-page" role="alert" data-testid="boot-error">
            <h1>{C.shell.bootFailed}</h1>
            <p>{bootError}</p>
          </div>
        ) : showWarehouse ? (
          <Suspense fallback={<StudioFallback />}>
            <TechniqueWarehouse />
          </Suspense>
        ) : showHub ? (
          <ProjectHub />
        ) : (
          <Suspense fallback={<StudioFallback />}>
            <Studio key={selected.target.mode + selected.target.path} item={selected} />
          </Suspense>
        )}
      </div>
      <Suspense fallback={null}>
        {settingsOpen ? <Settings /> : null}
        {onboarding ? <Onboarding /> : null}
      </Suspense>
      <Suspense fallback={null}>{creating ? <NewTargetDialog kind={creating} /> : null}</Suspense>
      <CommandPalette />
      <ConfirmDialog />
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
