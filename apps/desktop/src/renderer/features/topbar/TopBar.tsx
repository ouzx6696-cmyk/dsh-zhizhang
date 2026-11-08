import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Command,
  Settings as SettingsIcon,
  Plus,
  PanelRightOpen,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import { Brand } from "../../../../../../packages/ui/src/primitives";
import { shortcutLabel } from "../../../../../../packages/ui/src/keys";
import { scopeId, focusLabel } from "../../../context";
import { desktopStore, useDesktopSelector } from "../../state/store";
import type { DesktopActions } from "../../app/useDesktopController";

const set = desktopStore.set;
type ProjectItem = ReturnType<typeof desktopStore.get>["projects"][number];
/** 菜单项的范围：头条每篇文章各是一项，按文章区分。 */
const itemScope = (item: ProjectItem) => scopeId({ ...item.target, article: item.focus.article });
const STEP: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/** 菜单内 ↑/↓ 循环、Home/End 到首尾；菜单打开时焦点落到第一项。 */
function useMenuKeys(open: boolean) {
  const menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = STEP[event.key];
    const next = step
      ? items[(at + step + items.length) % items.length]
      : event.key === "Home"
        ? items[0]
        : event.key === "End"
          ? items[items.length - 1]
          : undefined;
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
  return { menu, onKeyDown };
}

export function TopBar({
  actions,
  onWorkflow,
}: {
  actions: DesktopActions;
  onWorkflow: () => void;
}) {
  const { fail } = actions;
  const system = useDesktopSelector((state) => state.system);
  const selected = useDesktopSelector((state) => state.selected);
  const focusTitle = useDesktopSelector((state) => state.focus.workTitle || state.focus.title);
  const view = useDesktopSelector((state) => state.view);
  const picker = useDesktopSelector((state) => state.picker);
  const projects = useDesktopSelector((state) => state.projects);
  const running = useDesktopSelector((state) => state.running);
  const [exportOpen, setExportOpen] = useState(false);
  const exportTrigger = useRef<HTMLButtonElement | null>(null);
  const projectSwitch = useRef<HTMLButtonElement | null>(null);
  const exportMenu = useMenuKeys(exportOpen);
  const projectMenu = useMenuKeys(picker);
  useEffect(() => {
    if (!exportOpen && !picker) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        exportOpen &&
        !exportMenu.menu.current?.contains(target) &&
        !exportTrigger.current?.contains(target)
      )
        setExportOpen(false);
      if (
        picker &&
        !projectMenu.menu.current?.contains(target) &&
        !projectSwitch.current?.contains(target)
      )
        set({ picker: false });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 这次 Esc 已用于关菜单；标记后全局快捷键不再关抽屉或询问停止任务。
      event.preventDefault();
      if (exportOpen) {
        setExportOpen(false);
        exportTrigger.current?.focus();
      }
      if (picker) {
        set({ picker: false });
        projectSwitch.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [exportOpen, picker, exportMenu.menu, projectMenu.menu]);
  const exportAs = (format: string) => {
    setExportOpen(false);
    actions.exportFile(format).catch((error) => fail(error, () => actions.exportFile(format)));
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
  const backgroundRunning = running.filter((item) => scopeId(item.target) !== scopeId(selected));
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
          aria-expanded={picker}
          onClick={() => set({ picker: !picker })}
        >
          <BookOpen size={15} />
          <span>
            {selected?.mode === "toutiao"
              ? viewCopy.ttTitle
              : focusTitle || selected?.work || viewCopy.topBarText2}
          </span>
          <ChevronDown size={13} className="studio-caret" data-open={picker} />
        </button>
        <button
          className="topbar-action"
          disabled={!selected?.work && !selected?.article}
          onClick={onWorkflow}
        >
          {viewCopy.workflowTitle}
        </button>
        <nav className="view-switch" aria-label={viewCopy.tabWriting}>
          {views.map(([id, label]) => (
            <button
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              key={id}
              onClick={() => void actions.changeView(id).catch(fail)}
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
        <div className="export-menu">
          <button
            ref={exportTrigger}
            className="export-trigger"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((open) => !open)}
          >
            {viewCopy.agentPanelText18}
            <ChevronDown size={13} className="studio-caret" data-open={exportOpen} />
          </button>
          {exportOpen && (
            <div
              ref={exportMenu.menu}
              className="export-options"
              role="menu"
              aria-label={viewCopy.agentPanelText18}
              onKeyDown={exportMenu.onKeyDown}
            >
              {(
                [
                  ["copy", viewCopy.topBarText4],
                  ["txt", viewCopy.topBarText5],
                  ["docx", viewCopy.topBarText6],
                ] as const
              ).map(([format, label]) => (
                <button key={format} role="menuitem" tabIndex={-1} onClick={() => exportAs(format)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="command-button" onClick={() => set({ palette: true })}>
          <Command size={14} />
          <span>
            {viewCopy.topBarText7}
            <kbd>{shortcutLabel("Ctrl K")}</kbd>
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
          onClick={() => set((current) => ({ drawer: !current.drawer }))}
        >
          <PanelRightOpen size={18} />
        </button>
      </header>
      {picker && (
        <div
          ref={projectMenu.menu}
          className="project-menu"
          role="menu"
          aria-label={viewCopy.topBarText10}
          onKeyDown={projectMenu.onKeyDown}
        >
          <h3 aria-hidden="true">{viewCopy.topBarText10}</h3>
          {projects.map((item) => (
            <button
              key={itemScope(item)}
              role="menuitem"
              tabIndex={-1}
              aria-current={itemScope(item) === scopeId(selected) || undefined}
              onClick={() => actions.jump(item.target, item.focus).catch(fail)}
            >
              <BookOpen size={14} />
              <span>{item.label}</span>
              <small>
                {item.target.mode === "fanqie" ? viewCopy.topBarText11 : viewCopy.topBarText12}
              </small>
            </button>
          ))}
          <div className="menu-actions" role="group">
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={() => actions.newWork("fanqie").catch(fail)}
            >
              <Plus size={14} />
              {viewCopy.topBarText13}
            </button>
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={() => actions.newWork("toutiao").catch(fail)}
            >
              <Plus size={14} />
              {viewCopy.topBarText14}
            </button>
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={() => actions.chooseWorkspace().catch(fail)}
            >
              {viewCopy.onboardingText4}
            </button>
          </div>
        </div>
      )}
      {system.access?.readOnly && (
        <div className="readonly-banner" role="status">
          <AlertCircle size={15} />
          {viewCopy.topBarText15}
          {system.access.owner.host || viewCopy.topBarText16}
          {viewCopy.topBarText17}
          <button onClick={() => actions.takeOverWorkspace().catch(fail)}>
            {viewCopy.topBarText18}
          </button>
        </div>
      )}
      {backgroundRunning.length > 0 && (
        <div className="background-tasks">
          {backgroundRunning.map((item) => (
            <button
              key={scopeId(item.target)}
              onClick={() => actions.jump(item.target, item.focus).catch(fail)}
            >
              <LoaderCircle size={13} className="spin" />
              {focusLabel(item.target, item.focus)} · {item.phase}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
