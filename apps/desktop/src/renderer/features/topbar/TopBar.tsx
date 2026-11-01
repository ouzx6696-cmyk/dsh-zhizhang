import React from "react";
import {
  BookOpen,
  ChevronDown,
  Command,
  Settings as SettingsIcon,
  Plus,
  FileDown,
  Copy,
  PanelRightOpen,
  X,
  AlertCircle,
  Feather,
  LoaderCircle,
} from "lucide-react";
import { scopeId, focusLabel } from "../../../context";
import type { DesktopController } from "../../app/useDesktopController";

export function TopBar({ app }: { app: DesktopController }) {
  const { state, system, selected, focus, fail, set } = app;
  if (!system) return null;
  return (
    <>
      <header className="studio-topbar">
        <div className="studio-brand">
          <Feather size={18} />
        </div>
        <button className="project-switch" onClick={() => set({ picker: !state.picker })}>
          <BookOpen size={15} />
          <span>
            {focus.workTitle ||
              focus.title ||
              selected?.work ||
              (selected?.mode === "toutiao" ? "今日头条" : "选择作品")}
          </span>
          <ChevronDown size={13} />
        </button>
        <nav className="view-switch">
          {[
            ["writing", "写作"],
            ["overview", "全书概况"],
            ["library", "拆书库"],
          ].map(([id, label]) => (
            <button
              className={state.view === id ? "active" : ""}
              key={id}
              onClick={() => set({ view: id })}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="model-status">
          <i data-ready={system.models.writer?.configured} />
          {system.models.writer?.model}
          <small> · 编辑 {system.models.editor?.model}</small>
        </span>
        <button
          className="icon-button"
          aria-label="导出稿件"
          onClick={() => app.exportFile("txt").catch(fail)}
        >
          <FileDown size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="复制标题与正文"
          onClick={() => app.exportFile("copy").catch(fail)}
        >
          <Copy size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="导出 Word"
          onClick={() => app.exportFile("docx").catch(fail)}
        >
          W
        </button>
        <button className="command-button" onClick={() => set({ palette: true, query: "" })}>
          <Command size={14} />
          <span>Ctrl K</span>
        </button>
        <button className="icon-button" aria-label="设置" onClick={() => set({ settingsOpen: true })}>
          <SettingsIcon size={17} />
        </button>
        <button
          className="sidebar-open icon-button"
          aria-label="打开右栏"
          onClick={() => set({ drawer: !state.drawer })}
        >
          <PanelRightOpen size={18} />
        </button>
      </header>
      {state.picker && (
        <div className="project-menu">
          <h3>最近作品</h3>
          {state.projects.map((item, index) => (
            <button key={index} onClick={() => app.jump(item.target, item.focus).catch(fail)}>
              <BookOpen size={14} />
              {item.label}
              <small>{item.target.mode === "fanqie" ? "长篇" : "头条"}</small>
            </button>
          ))}
          <div className="menu-actions">
            <button onClick={() => app.newWork("fanqie").catch(fail)}>
              <Plus size={14} />
              新书
            </button>
            <button onClick={() => app.newWork("toutiao").catch(fail)}>
              <Plus size={14} />
              新头条
            </button>
            <button onClick={() => app.chooseWorkspace().catch(fail)}>选择写作根</button>
          </div>
        </div>
      )}
      {system.access?.readOnly && (
        <div className="readonly-banner">
          <AlertCircle size={15} />
          当前作品由 {system.access.owner?.host || "另一应用"} 占用，只读。关闭另一应用中的作品后，
          重新打开即可写入。
        </div>
      )}
      {state.running.filter((item) => scopeId(item.target) !== scopeId(selected)).length > 0 && (
        <div className="background-tasks">
          {state.running
            .filter((item) => scopeId(item.target) !== scopeId(selected))
            .map((item) => (
              <button key={scopeId(item.target)} onClick={() => app.jump(item.target, item.focus).catch(fail)}>
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
          <button className="icon-button" aria-label="关闭提示" onClick={() => set({ error: "" })}>
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
