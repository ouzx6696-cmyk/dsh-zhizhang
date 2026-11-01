import React, { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { profilesApi } from "../../../../../../packages/workbench/src/client/shared/api.js";
import { ProfilesDialog } from "../../../../../../packages/workbench/src/client/shared/Profiles.jsx";
import { Menu, PanelRightClose } from "lucide-react";

export type EditState = { dirty: boolean; saving: boolean };
const tabs = [
  ["agent", "Agent"],
  ["chapter", "本章"],
  ["methods", "方法方案"],
];

function MethodsPane({
  mode,
  onOpen,
  active,
}: {
  mode: "fanqie" | "toutiao";
  onOpen: () => void;
  active: boolean;
}) {
  const [name, setName] = useState("默认");
  useEffect(() => {
    if (!active) return;
    let running = true;
    profilesApi(mode)
      .list()
      .then((result: any) => {
        if (running) setName(result.profiles?.find((profile: any) => profile.active)?.name || "默认");
      })
      .catch(() => {});
    return () => {
      running = false;
    };
  }, [mode, active]);
  return (
    <div className="method-cta">
      <p>当前方案：{name}</p>
      <button className="primary" onClick={onOpen}>
        打开方法方案
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
    <ProfilesDialog
      mode={mode}
      api={api}
      inline
      onEditState={onEditState}
      onClose={() => {}}
      onChanged={() => {}}
    />
  );
}

export function WorkspaceLayout({
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
  const [navOpen, setNavOpen] = useState(false);
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [methodsMounted, setMethodsMounted] = useState(false);
  const openMethods = () => {
    setMethodsMounted(true);
    setMethodsOpen(true);
  };
  return (
    <div className="studio-layout">
      <nav className={"studio-nav " + (navOpen ? "expanded" : "")}>
        <button
          className="nav-toggle icon-button"
          aria-label="展开章节导航"
          onClick={() => setNavOpen(!navOpen)}
        >
          <Menu size={18} />
        </button>
        {navigation}
      </nav>
      <section className="studio-paper-column">{center}</section>
      <aside className={"studio-sidebar " + (drawer ? "open" : "")}>
        <div className="studio-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
          <button
            className="drawer-close icon-button"
            aria-label="收起右栏"
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
        <div
          className="studio-backdrop methods-backdrop"
          style={{ display: methodsOpen ? undefined : "none" }}
        >
        <section className="methods-page" role="dialog" aria-modal="true" aria-label="方法方案">
          <header>
            <h2>方法方案</h2>
            <button
              className="icon-button"
              aria-label="关闭方法方案"
              onClick={() => setMethodsOpen(false)}
            >
              ×
            </button>
          </header>
          <MethodsEditor mode={mode} onEditState={onMethodEditState} />
        </section>
        </div>
      )}
    </div>
  );
}
