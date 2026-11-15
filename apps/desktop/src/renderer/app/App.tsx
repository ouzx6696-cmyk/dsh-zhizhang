import React, { Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@zhizhang/ui/components.css";
import "@zhizhang/workbench/styles.css";
import "../styles/index.css";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { NoticeStack } from "@zhizhang/ui/notify";
import { Brand, Button, Skeleton, Spinner } from "@zhizhang/ui/primitives";
import { setConfirm } from "@zhizhang/workbench/client";
import { askConfirm } from "../state/confirm";
import { boot, startCreate } from "../state/controller";
import { subscribeDesktopEvents } from "../state/events";
import { desktopStore, useDesktop } from "../state/store";
import { errorText, notifyError } from "../format";
import { ConfirmDialog } from "../features/confirm/ConfirmDialog";
import { TopBar } from "../features/topbar/TopBar";
import { RootErrorBoundary, reportUnhandledRejection } from "./crash";
import { useAppearance } from "./useAppearance";
import { useShortcuts } from "./useShortcuts";

// 写作台（中栏写作区 + 右栏助手 / 流水线）在选中作品后才需要，懒加载出入口包。
const Studio = lazy(() =>
  import("../features/workspace/Studio").then((m) => ({ default: m.Studio })),
);
const NewTargetDialog = lazy(() =>
  import("../features/create/NewTargetDialog").then((m) => ({ default: m.NewTargetDialog })),
);
const Settings = lazy(() =>
  import("../features/settings/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
// 稿纸字体单独成块：@font-face 声明不进入口 CSS，字体文件按 unicode-range 按需下载（font-display: swap）。
void import("../styles/paper-fonts");

const Onboarding = lazy(() =>
  import("../features/onboarding/Onboarding").then((m) => ({ default: m.Onboarding })),
);

function Welcome() {
  const configured = useDesktop((state) => Boolean(state.workspace?.configured));
  return (
    <div className="zz-empty-page" data-testid="welcome">
      <Brand label={COPY["app.name"]} className="zz-brand--lg" />
      <h1>{C.shell.welcomeTitle}</h1>
      <p>{configured ? C.shell.welcomePick : C.shell.welcomeSetup}</p>
      {configured ? (
        <div className="zz-row">
          <Button
            variant="primary"
            data-testid="welcome-new-work"
            onClick={() => startCreate("fanqie")}
          >
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

function StudioFallback() {
  return (
    <div className="zz-studio-fallback" aria-busy="true">
      <Skeleton lines={10} />
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
        <Brand label={COPY["app.name"]} />
        <span className="zz-startup__text">
          <Spinner size="sm" label={C.shell.starting} />
          {C.shell.starting}
        </span>
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
        <Suspense fallback={<StudioFallback />}>
          <Studio key={selected.target.mode + selected.target.path} item={selected} />
        </Suspense>
      ) : (
        <Welcome />
      )}
      <Suspense fallback={null}>
        {settingsOpen ? <Settings /> : null}
        {onboarding ? <Onboarding /> : null}
      </Suspense>
      <Suspense fallback={null}>{creating ? <NewTargetDialog kind={creating} /> : null}</Suspense>
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
