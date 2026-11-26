import React, { useState } from "react";
import { Download, Maximize2, Minimize2, PanelRight, RotateCcw } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, IconButton, Menu } from "@zhizhang/ui/primitives";
import type { ExportFormat, TargetItem } from "../../../shared/views";
import { desktop } from "../../state/desktop";
import { desktopStore, sameTarget, useDesktop } from "../../state/store";
import { notifyError, run } from "../../format";
import { hasCandidate, requestField } from "../workflow/workflow-model";

const set = desktopStore.set;

async function exportAs(format: ExportFormat) {
  const target = desktopStore.get().selected?.target;
  if (!target) return;
  const result = await desktop.exportFile(target, { format });
  if (!result) return;
  notify({
    tone: "success",
    text: "copied" in result ? C.topbar.copied(result.chars) : C.topbar.exported(result.file),
  });
}

/**
 * 中栏极简顶条：面包屑 + 单稿/对照 切换（存在待裁决候选稿时显示）+ 采纳撤销条 + 专注模式（Ctrl .）+ 导出 + 右栏开关。
 */
export function CenterBar({ item }: { item: TargetItem }) {
  const focus = useDesktop((s) => s.focus);
  const view = useDesktop((s) => s.view);
  const runs = useDesktop((s) => s.runs);
  const compare = useDesktop((s) => s.compare);
  const zenMode = useDesktop((s) => s.zenMode);
  const dockOpen = useDesktop((s) => s.dockOpen);
  const adoptedUndo = useDesktop((s) => s.adoptedUndo);
  const [exportOpen, setExportOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const awaitingRun = runs.find(
    (r) =>
      sameTarget(r.target, item.target) && r.state === "awaiting-author" && hasCandidate(r.kind),
  );
  const comparing = Boolean(compare && sameTarget(compare.target, item.target));
  const formats: ExportFormat[] =
    item.target.mode === "toutiao" ? ["md", "txt", "copy"] : ["txt", "docx", "copy"];

  const openCompareMode = () => {
    if (!awaitingRun) return;
    run(async () => {
      const detail = await desktop.getRun({ runId: awaitingRun.id, target: awaitingRun.target });
      const chapter = requestField(detail, "chapterId") || focus.chapter || "";
      if (!chapter) return;
      set({
        compare: { target: awaitingRun.target, runId: awaitingRun.id, chapter },
        view: "writing",
      });
    });
  };

  const canUndo = Boolean(
    adoptedUndo &&
    sameTarget(adoptedUndo.target, item.target) &&
    (!focus.chapter || adoptedUndo.chapter === focus.chapter),
  );

  const performUndo = async () => {
    if (!adoptedUndo) return;
    setUndoing(true);
    try {
      const current = await desktop.workbench("fanqie.chapter.get", {
        work: adoptedUndo.target.path,
        chapter: adoptedUndo.chapter,
      });
      await desktop.workbench("fanqie.chapter.save", {
        work: adoptedUndo.target.path,
        chapter: adoptedUndo.chapter,
        base: current.revision,
        body: adoptedUndo.body,
        title: adoptedUndo.title || undefined,
      });
      set({ adoptedUndo: null });
      notify({ tone: "success", text: C.rail.undoneAdopt });
    } catch (err) {
      notifyError(err);
    } finally {
      setUndoing(false);
    }
  };

  const rawSubCrumb =
    view === "bible"
      ? C.topbar.viewBible
      : view === "board"
        ? item.target.mode === "toutiao"
          ? C.topbar.viewLedger
          : C.topbar.viewBoard
        : focus.title || focus.chapter || focus.article || "";

  const isSameAsLabel = Boolean(rawSubCrumb && rawSubCrumb === item.label);
  const parentCrumb = isSameAsLabel
    ? item.target.mode === "toutiao"
      ? C.rail.modeToutiao
      : C.rail.modeFanqie
    : item.label;
  const subCrumb = rawSubCrumb;

  return (
    <header className="zz-centerbar" data-testid="center-bar">
      <div className="zz-centerbar__crumb">
        <span className="zz-centerbar__work">{parentCrumb}</span>
        {subCrumb ? (
          <>
            <span className="zz-centerbar__sep" aria-hidden="true">
              ›
            </span>
            <span className="zz-centerbar__leaf">{subCrumb}</span>
          </>
        ) : null}
        {canUndo ? (
          <span className="zz-centerbar__undo" data-testid="adopt-undo-bar">
            <span>{C.rail.adoptedUndoHint}</span>
            <Button
              size="xs"
              variant="text"
              data-testid="adopt-undo-btn"
              loading={undoing}
              onClick={() => void performUndo()}
            >
              <RotateCcw size={12} aria-hidden="true" />
              {C.rail.undoAdopt}
            </Button>
          </span>
        ) : null}
      </div>

      <div className="zz-centerbar__tools">
        {awaitingRun && view === "writing" ? (
          <div className="zz-centerbar__seg" role="tablist" aria-label={C.workflow.compareTitle}>
            <button
              type="button"
              role="tab"
              aria-selected={!comparing}
              className="zz-centerbar__seg-btn"
              onClick={() => set({ compare: null })}
            >
              {C.rail.singleView}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={comparing}
              data-testid="center-compare-tab"
              className="zz-centerbar__seg-btn"
              onClick={openCompareMode}
            >
              <span className="zz-centerbar__decide-dot" aria-hidden="true" />
              {C.rail.compareView}
            </button>
          </div>
        ) : null}

        {view === "writing" ? (
          <Button
            size="xs"
            variant="ghost"
            data-testid="zen-toggle"
            aria-pressed={zenMode}
            onClick={() => set({ zenMode: !zenMode })}
          >
            {zenMode ? (
              <Minimize2 size={13} aria-hidden="true" />
            ) : (
              <Maximize2 size={13} aria-hidden="true" />
            )}
            <span>{zenMode ? C.rail.exitFocus : C.rail.focusMode}</span>
            {!zenMode ? <kbd className="zz-centerbar__kbd">{C.rail.focusShortcut}</kbd> : null}
          </Button>
        ) : null}

        <div className="zz-menu-root zz-centerbar__menu">
          <IconButton
            size="xs"
            variant="ghost"
            label={C.topbar.export}
            data-testid="export-menu"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            icon={<Download size={14} />}
            onClick={() => setExportOpen((v) => !v)}
          />
          {exportOpen ? (
            <Menu
              label={C.topbar.export}
              className="zz-menu--end"
              items={formats.map((format) => ({
                id: format,
                label: C.topbar.exportFormat[format],
                onSelect: () => exportAs(format).catch(notifyError),
              }))}
              onClose={() => setExportOpen(false)}
            />
          ) : null}
        </div>

        {!zenMode ? (
          <IconButton
            size="xs"
            variant="ghost"
            label={C.topbar.toggleDock}
            pressed={dockOpen}
            data-testid="dock-toggle"
            icon={<PanelRight size={14} />}
            onClick={() => set({ dockOpen: !dockOpen })}
          />
        ) : null}
      </div>
    </header>
  );
}
