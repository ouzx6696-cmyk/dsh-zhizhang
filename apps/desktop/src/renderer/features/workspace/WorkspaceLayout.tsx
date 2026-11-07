import { errorText } from "../../../../../../packages/core/src/errors.js";
import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import { Markdown } from "../../../Markdown";
import { Dialog } from "../../../../../../packages/ui/src/primitives";
import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { profilesApi } from "../../../../../../packages/workbench/src/client/shared/api.js";
import { Menu, PanelRightClose } from "lucide-react";
import { askConfirm } from "../../state/confirm";

// 方法方案编辑器体积大且仅在作者打开方法页时需要，按需加载。
const ProfilesDialog = lazy(() =>
  import("../../../../../../packages/workbench/src/client/shared/Profiles.jsx").then((module) => ({
    default: module.ProfilesDialog,
  })),
);

type EditState = { dirty: boolean; saving: boolean };

/** 方法面板只读当前方案名；回执缺该字段时保持默认标题。 */
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
        confirm={askConfirm}
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
  tab,
  setTab,
  mode,
  drawer,
  setDrawer,
  onMethodEditState,
}: {
  fullWidth?: boolean;
  navigation: ReactNode;
  center: ReactNode;
  inspector: ReactNode;
  agent: ReactNode;
  tab: string;
  setTab: (tab: string) => void;
  mode: "fanqie" | "toutiao";
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  onMethodEditState: (state: EditState) => void;
}) {
  const tabs: [string, string][] = [
    ["agent", "Agent"],
    ["chapter", mode === "toutiao" ? viewCopy.workspaceLayoutText4 : viewCopy.inspector],
    ["methods", viewCopy.pfButton],
  ];
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
      <aside className={"studio-sidebar " + (drawer ? "open" : "")}>
        <div className="studio-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
          <button
            className="drawer-close icon-button"
            aria-label={viewCopy.workspaceLayoutText7}
            onClick={() => setDrawer(false)}
          >
            <PanelRightClose size={16} />
          </button>
        </div>
        <div className="studio-side-body" data-tab={tab}>
          <div hidden={tab !== "agent"} className="agent-slot">
            {agent}
          </div>
          {tab === "chapter" && <div className="decision-panel">{inspector}</div>}
          <div hidden={tab !== "methods"} style={{ height: "100%" }}>
            <MethodsPane mode={mode} onOpen={openMethods} active={tab === "methods"} />
          </div>
        </div>
      </aside>
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
