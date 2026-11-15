import { errorText } from "@zhizhang/core";
import { DESKTOP_COPY as viewCopy } from "../../../shared/copy";
import { Markdown } from "../../../Markdown";
import { Dialog } from "../../components/primitives";
import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { profilesApi } from "@zhizhang/workbench";
import { Menu } from "lucide-react";
import { RightDock } from "./RightDock";

const ProfilesDialog = lazy(() =>
  import("@zhizhang/workbench").then((module) => ({
    default: module.ProfilesDialog,
  })),
);

type EditState = { dirty: boolean; saving: boolean };

function hasActiveName(value: unknown): value is { activeName: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "activeName" in value &&
    typeof value.activeName === "string"
  );
}

function MethodsPane({
  mode,
  onOpen,
  active,
}: {
  mode: "fanqie" | "toutiao";
  onOpen: () => void;
  active: boolean;
}) {
  const [name, setName] = useState<string>(viewCopy.workspaceLayoutText1);
  useEffect(() => {
    if (!active) return;
    let running = true;
    profilesApi(mode)
      .list()
      .then((result) => {
        if (running && hasActiveName(result)) setName(result.activeName);
      })
      .catch((error: unknown) => {
        if (running) setName(errorText(error));
      });
    return () => {
      running = false;
    };
  }, [mode, active]);
  return (
    <div className="method-cta">
      <p>
        {viewCopy.workspaceLayoutText2}
        {name}
      </p>
      <button className="primary" onClick={onOpen}>
        {viewCopy.workspaceLayoutText3}
      </button>
    </div>
  );
}

function MethodsEditor({
  mode,
  onEditState,
}: {
  mode: "fanqie" | "toutiao";
  onEditState: (state: EditState) => void;
}) {
  const api = useMemo(() => profilesApi(mode), [mode]);
  return (
    <Suspense fallback={null}>
      <ProfilesDialog
        mode={mode}
        api={api}
        inline
        renderContent={(text: string) => <Markdown text={text} />}
        onEditState={onEditState}
        onClose={() => {}}
        onChanged={() => {}}
      />
    </Suspense>
  );
}

export function WorkspaceLayout({
  fullWidth = false,
  navigation,
  center,
  inspector,
  agent,
  pipeline,
  tab,
  setTab,
  mode,
  drawer,
  setDrawer,
  split = false,
  onToggleSplit = () => {},
  onMethodEditState,
}: {
  fullWidth?: boolean;
  navigation: ReactNode;
  center: ReactNode;
  inspector: ReactNode;
  agent: ReactNode;
  pipeline?: ReactNode;
  tab: string;
  setTab: (tab: string) => void;
  mode: "fanqie" | "toutiao";
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  split?: boolean;
  onToggleSplit?: () => void;
  onMethodEditState: (state: EditState) => void;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [methodsMounted, setMethodsMounted] = useState(false);
  const openMethods = () => {
    setMethodsMounted(true);
    setMethodsOpen(true);
  };
  return (
    <div className="studio-layout" data-fullwidth={fullWidth}>
      <nav className={"studio-nav " + (navOpen ? "expanded" : "")}>
        <button
          className="nav-toggle icon-button"
          aria-label={viewCopy.workspaceLayoutText5}
          onClick={() => setNavOpen(!navOpen)}
        >
          <Menu size={18} />
        </button>
        {navigation}
      </nav>
      <section className="studio-paper-column">{center}</section>
      {drawer && (
        <button
          type="button"
          className="drawer-scrim"
          aria-label={viewCopy.workspaceLayoutText6}
          onClick={() => setDrawer(false)}
        />
      )}
      <RightDock
        tab={tab}
        setTab={setTab}
        drawer={drawer}
        setDrawer={setDrawer}
        split={split}
        onToggleSplit={onToggleSplit}
        mode={mode}
        agent={agent}
        pipeline={pipeline}
        inspector={inspector}
        methodsPane={<MethodsPane mode={mode} onOpen={openMethods} active={tab === "methods"} />}
      />
      {methodsMounted && (
        <Dialog
          open={methodsOpen}
          title={viewCopy.pfButton}
          className="methods-page"
          onClose={() => setMethodsOpen(false)}
        >
          <header>
            <h2>{viewCopy.pfButton}</h2>
            <button
              className="icon-button"
              aria-label={viewCopy.workspaceLayoutText8}
              autoFocus
              onClick={() => setMethodsOpen(false)}
            >
              ×
            </button>
          </header>
          <MethodsEditor mode={mode} onEditState={onMethodEditState} />
        </Dialog>
      )}
    </div>
  );
}
