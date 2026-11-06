import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Command,
  Settings as SettingsIcon,
  Plus,
  PanelRightOpen,
  X,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import { Brand } from "../../../../../../packages/ui/src/primitives";
import { scopeId, focusLabel } from "../../../context";
import type { DesktopController } from "../../app/useDesktopController";

export function TopBar({ app }: { app: DesktopController }) {
  const { state, system, selected, focus, fail, set } = app;
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenu = useRef<HTMLDivElement | null>(null);
  const projectSwitch = useRef<HTMLButtonElement | null>(null);
  const projectMenu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!exportOpen && !state.picker) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (exportOpen && !exportMenu.current?.contains(target)) setExportOpen(false);
      if (
        state.picker &&
        !projectMenu.current?.contains(target) &&
        !projectSwitch.current?.contains(target)
      ) {
        set({ picker: false });
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (exportOpen) setExportOpen(false);
      if (state.picker) set({ picker: false });
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [exportOpen, state.picker, set]);
  const exportAs = (format: string) => {
    setExportOpen(false);
    app.exportFile(format).catch(fail);
  };
  const views: [string, string][] =
    selected?.mode === "toutiao"
      ? [
          ["writing", viewCopy.tabWriting],
          ["overview", viewCopy.ttLedgerTitle],
        ]
      : [
          ["writing", viewCopy.tabWriting],
          ["overview", viewCopy.overview],
          ["library", viewCopy.topBarText1],
        ];
  if (!system) return null;
  const backgroundRunning = state.running.filter(
    (item) => scopeId(item.target) !== scopeId(selected),
  );
  return (
    <>
      <header className="studio-topbar">
        <div className="studio-brand">
          <Brand />
        </div>
        <button
          ref={projectSwitch}
          className="project-switch"
          aria-haspopup="menu"
          aria-expanded={state.picker}
          onClick={() => set({ picker: !state.picker })}
        >
          <BookOpen size={15} />
          <span>
            {selected?.mode === "toutiao"
              ? viewCopy.ttTitle
              : focus.workTitle || focus.title || selected?.work || viewCopy.topBarText2}
          </span>
          <ChevronDown size={13} />
        </button>
        <nav className="view-switch">
          {views.map(([id, label]) => (
            <button
              className={state.view === id ? "active" : ""}
              key={id}
              onClick={() => app.changeView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="model-status">
          <i data-ready={system.models.writer.configured} />
          {system.models.writer.model}
          <small>
            {viewCopy.topBarText3}
            {system.models.editor.model}
          </small>
        </span>
        <div className="export-menu" ref={exportMenu}>
          <button
            className="export-trigger"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((open) => !open)}
          >
            {viewCopy.agentPanelText18}
            <ChevronDown size={13} />
          </button>
          {exportOpen && (
            <div className="export-options" role="menu" aria-label={viewCopy.agentPanelText18}>
              <button role="menuitem" onClick={() => exportAs("copy")}>
                {viewCopy.topBarText4}
              </button>
              <button role="menuitem" onClick={() => exportAs("txt")}>
                {viewCopy.topBarText5}
              </button>
              <button role="menuitem" onClick={() => exportAs("docx")}>
                {viewCopy.topBarText6}
              </button>
            </div>
          )}
        </div>
        <button className="command-button" onClick={() => set({ palette: true, query: "" })}>
          <Command size={14} />
          <span>
            {viewCopy.topBarText7}
            <kbd>Ctrl K</kbd>
          </span>
        </button>
        <button
          className="icon-button"
          aria-label={viewCopy.settingsDialogText2}
          onClick={() => set({ settingsOpen: true })}
        >
          <SettingsIcon size={17} />
          {viewCopy.topBarText8}
        </button>
        <button
          className="sidebar-open icon-button"
          aria-label={viewCopy.topBarText9}
          onClick={() => set({ drawer: !state.drawer })}
        >
          <PanelRightOpen size={18} />
        </button>
      </header>
      {state.picker && (
        <div className="project-menu" ref={projectMenu} role="menu">
          <h3>{viewCopy.topBarText10}</h3>
          {state.projects.map((item, index) => (
            <button key={index} onClick={() => app.jump(item.target, item.focus).catch(fail)}>
              <BookOpen size={14} />
              {item.label}
              <small>
                {item.target.mode === "fanqie" ? viewCopy.topBarText11 : viewCopy.topBarText12}
              </small>
            </button>
          ))}
          <div className="menu-actions">
            <button onClick={() => app.newWork("fanqie").catch(fail)}>
              <Plus size={14} />
              {viewCopy.topBarText13}
            </button>
            <button onClick={() => app.newWork("toutiao").catch(fail)}>
              <Plus size={14} />
              {viewCopy.topBarText14}
            </button>
            <button onClick={() => app.chooseWorkspace().catch(fail)}>
              {viewCopy.onboardingText4}
            </button>
          </div>
        </div>
      )}
      {system.access?.readOnly && (
        <div className="readonly-banner">
          <AlertCircle size={15} />
          {viewCopy.topBarText15}
          {system.access.owner?.host || viewCopy.topBarText16}
          {viewCopy.topBarText17}
        </div>
      )}
      {backgroundRunning.length > 0 && (
        <div className="background-tasks">
          {backgroundRunning.map((item) => (
            <button
              key={scopeId(item.target)}
              onClick={() => app.jump(item.target, item.focus).catch(fail)}
            >
              <LoaderCircle size={13} className="spin" />
              {focusLabel(item.target, item.focus)} · {item.phase}
            </button>
          ))}
        </div>
      )}
      {state.error && (
        <div className="studio-error" role="alert">
          <AlertCircle size={16} />
          {state.error}
          <button
            className="icon-button"
            aria-label={viewCopy.topBarText18}
            onClick={() => set({ error: "" })}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
