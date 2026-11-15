import React, { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Download,
  PanelRight,
  Settings as SettingsIcon,
  Workflow,
} from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Brand, Button, IconButton, Menu, type MenuItem } from "@zhizhang/ui/primitives";
import type { ExportFormat, TargetItem } from "../../../shared/views";
import {
  modelReady,
  openPipeline,
  openSettings,
  select,
  startCreate,
  takeOverWorkspace,
} from "../../state/controller";
import { desktop } from "../../state/desktop";
import { desktopStore, sameTarget, useDesktop, type MainView } from "../../state/store";
import { notifyError, run } from "../../format";

const set = desktopStore.set;

function targetMenu(targets: TargetItem[], current: TargetItem | null): MenuItem[] {
  const works = targets.filter((t) => t.kind === "work");
  const articles = targets.filter((t) => t.kind === "article");
  const item = (t: TargetItem): MenuItem => ({
    id: t.target.mode + t.target.path,
    label: (
      <span
        className="zz-target-item"
        data-testid="target-item"
        data-mode={t.target.mode}
        data-current={sameTarget(t.target, current?.target)}
      >
        {t.label}
      </span>
    ),
    onSelect: () => run(() => select(t.target)),
  });
  const items: MenuItem[] = [
    { id: "h-works", label: C.topbar.works, disabled: true },
    ...works.map(item),
    { id: "new-work", label: C.create.newWork, onSelect: () => startCreate("fanqie") },
    { id: "sep", label: "", separator: true },
    { id: "h-articles", label: C.topbar.articles, disabled: true },
    ...articles.map(item),
    { id: "new-article", label: C.create.newArticle, onSelect: () => startCreate("toutiao") },
  ];
  return items;
}

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

export function TopBar() {
  const selected = useDesktop((state) => state.selected);
  const targets = useDesktop((state) => state.targets);
  const view = useDesktop((state) => state.view);
  const running = useDesktop((state) => state.running);
  const workspace = useDesktop((state) => state.workspace);
  const settings = useDesktop((state) => state.settings);
  const dockOpen = useDesktop((state) => state.dockOpen);
  const [menu, setMenu] = useState<"" | "targets" | "export">("");
  const close = () => setMenu("");
  const views: { id: MainView; label: string }[] = [
    { id: "writing", label: C.topbar.viewWriting },
    {
      id: "board",
      label: selected?.target.mode === "toutiao" ? C.topbar.viewLedger : C.topbar.viewBoard,
    },
  ];
  const formats: ExportFormat[] =
    selected?.target.mode === "toutiao" ? ["md", "txt", "copy"] : ["txt", "docx", "copy"];
  const ready = modelReady(settings);
  return (
    <>
      <header className="zz-topbar" data-testid="topbar">
        <Brand label={COPY["app.name"]} />
        <div className="zz-topbar__menu">
          <Button
            variant="ghost"
            data-testid="target-switch"
            aria-haspopup="menu"
            aria-expanded={menu === "targets"}
            disabled={!workspace?.configured}
            onClick={() => setMenu(menu === "targets" ? "" : "targets")}
          >
            <BookOpen size={15} aria-hidden="true" />
            <span data-testid="target-label">{selected?.label ?? C.topbar.pickTarget}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </Button>
          {menu === "targets" ? (
            <div data-testid="target-menu">
              <Menu
                label={C.topbar.pickTarget}
                items={targetMenu(targets, selected)}
                onClose={close}
              />
            </div>
          ) : null}
        </div>
        {selected ? (
          <nav className="zz-segmented zz-segmented--sm" aria-label={C.topbar.views}>
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                className="zz-segmented__item"
                aria-pressed={view === v.id}
                data-testid={`view-${v.id}`}
                onClick={() => set({ view: v.id })}
              >
                {v.label}
              </button>
            ))}
          </nav>
        ) : null}
        <span className="zz-topbar__spacer" />
        {running.length ? (
          <Button
            variant="ghost"
            size="sm"
            data-testid="running-indicator"
            onClick={() => openPipeline()}
          >
            <Workflow size={14} aria-hidden="true" />
            {C.topbar.running(running.length)}
          </Button>
        ) : null}
        <button
          type="button"
          className="zz-model-status"
          data-testid="model-status"
          data-ready={ready}
          onClick={() => openSettings("models")}
        >
          <i aria-hidden="true" />
          {ready ? C.topbar.modelReady : C.topbar.modelMissing}
        </button>
        {selected ? (
          <div className="zz-topbar__menu">
            <IconButton
              label={C.topbar.export}
              data-testid="export-menu"
              icon={<Download size={16} />}
              onClick={() => setMenu(menu === "export" ? "" : "export")}
            />
            {menu === "export" ? (
              <Menu
                label={C.topbar.export}
                className="zz-menu--end"
                items={formats.map((format) => ({
                  id: format,
                  label: C.topbar.exportFormat[format],
                  onSelect: () => exportAs(format).catch(notifyError),
                }))}
                onClose={close}
              />
            ) : null}
          </div>
        ) : null}
        {selected ? (
          <IconButton
            label={C.topbar.toggleDock}
            pressed={dockOpen}
            data-testid="dock-toggle"
            icon={<PanelRight size={16} />}
            onClick={() => set({ dockOpen: !dockOpen })}
          />
        ) : null}
        <IconButton
          label={C.topbar.settings}
          data-testid="open-settings"
          icon={<SettingsIcon size={16} />}
          onClick={() => openSettings()}
        />
      </header>
      {workspace?.readonly ? (
        <div className="zz-banner" role="status" data-testid="readonly-banner">
          <span>{C.topbar.readonly(workspace.owner ?? "")}</span>
          {workspace.owner ? (
            <Button size="sm" data-testid="take-over" onClick={() => run(takeOverWorkspace)}>
              {C.topbar.takeOver}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
