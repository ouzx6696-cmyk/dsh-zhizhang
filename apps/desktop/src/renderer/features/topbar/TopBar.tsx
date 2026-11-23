import React, { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Command,
  Download,
  Maximize2,
  Minimize2,
  PanelRight,
  Settings as SettingsIcon,
} from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Brand, Button, IconButton, Menu, type MenuItem } from "@zhizhang/ui/primitives";
import type { ExportFormat, RunSummary, TargetItem } from "../../../shared/views";
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
import { kindLabel, progressGroups, progressIndex, stageLabel } from "../workflow/workflow-model";

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
  return [
    { id: "h-works", label: C.topbar.works, heading: true },
    ...works.map(item),
    { id: "new-work", label: C.create.newWork, onSelect: () => startCreate("fanqie") },
    { id: "sep", label: "", separator: true },
    { id: "h-articles", label: C.topbar.articles, heading: true },
    ...articles.map(item),
    { id: "new-article", label: C.create.newArticle, onSelect: () => startCreate("toutiao") },
  ];
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

/** 顶栏胶囊与全局进度轨看的那一条：等你决定 > 失败 > 运行中 > 暂停；同级取最近更新。 */
export function headlineRun(runs: readonly RunSummary[]): RunSummary | null {
  const rank = { "awaiting-author": 0, failed: 1, running: 2, paused: 3 } as const;
  const scored = runs
    .filter((r): r is RunSummary & { state: keyof typeof rank } => r.state in rank)
    .sort((a, b) => rank[a.state] - rank[b.state] || b.updated.localeCompare(a.updated));
  return scored[0] ?? null;
}

function RunPill({ head, extra }: { head: RunSummary; extra: number }) {
  const total = progressGroups(head.kind).length;
  const step = Math.min(total, progressIndex(head) + (head.state === "awaiting-author" ? 0 : 1));
  const last = head.stages[head.stages.length - 1];
  const detail =
    head.state === "awaiting-author"
      ? COPY["workflow.awaiting_author"]
      : head.state === "running"
        ? last
          ? stageLabel(last)
          : C.workflow.state.running
        : C.workflow.state[head.state];
  return (
    <button
      type="button"
      className="zz-run-pill"
      data-testid="running-indicator"
      data-state={head.state}
      title={C.topbar.openPipeline}
      onClick={() => openPipeline()}
    >
      <i aria-hidden="true" />
      <span className="zz-run-pill__kind">{kindLabel(head.kind)}</span>
      <span className="zz-run-pill__detail">{detail}</span>
      {total && head.state !== "awaiting-author" ? (
        <span className="zz-run-pill__step">{C.topbar.runStep(step, total)}</span>
      ) : null}
      {extra > 0 ? <span className="zz-run-pill__more">{C.topbar.moreRuns(extra)}</span> : null}
    </button>
  );
}

/** 顶栏下 2px 进度轨：运行蓝色流光、等你决定琥珀、失败红；没有任务时不占位。 */
export function GlobalRail() {
  const runs = useDesktop((s) => s.runs);
  const head = headlineRun(runs);
  if (!head) return null;
  const total = Math.max(1, progressGroups(head.kind).length);
  const percent =
    head.state === "awaiting-author"
      ? 100
      : Math.round(((progressIndex(head) + 0.5) / total) * 100);
  return (
    <div className="zz-global-rail" data-state={head.state} aria-hidden="true">
      <span style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

export function TopBar() {
  const selected = useDesktop((state) => state.selected);
  const targets = useDesktop((state) => state.targets);
  const view = useDesktop((state) => state.view);
  const runs = useDesktop((state) => state.runs);
  const running = useDesktop((state) => state.running);
  const workspace = useDesktop((state) => state.workspace);
  const settings = useDesktop((state) => state.settings);
  const dockOpen = useDesktop((state) => state.dockOpen);
  const zenMode = useDesktop((state) => state.zenMode);
  const [menu, setMenu] = useState<"" | "targets" | "export">("");
  const close = () => setMenu("");

  const views: { id: MainView; label: string }[] = [
    { id: "hub", label: C.topbar.viewHub },
    ...(selected
      ? [
          { id: "writing" as const, label: C.topbar.viewWriting },
          {
            id: "board" as const,
            label: selected.target.mode === "toutiao" ? C.topbar.viewLedger : C.topbar.viewBoard,
          },
          ...(selected.target.mode === "fanqie"
            ? [{ id: "bible" as const, label: C.topbar.viewBible }]
            : []),
        ]
      : []),
    ...(workspace?.configured ? [{ id: "warehouse" as const, label: C.topbar.viewWarehouse }] : []),
  ];

  const formats: ExportFormat[] =
    selected?.target.mode === "toutiao" ? ["md", "txt", "copy"] : ["txt", "docx", "copy"];
  const ready = modelReady(settings);
  const head = headlineRun(runs);
  const awaiting = runs.some((r) => r.state === "awaiting-author");

  useEffect(() => {
    document.title = awaiting ? `${C.topbar.awaitingPrefix}${COPY["app.name"]}` : COPY["app.name"];
  }, [awaiting]);

  return (
    <>
      <header className="zz-topbar" data-testid="topbar">
        <Brand label={COPY["app.name"]} />
        <div className="zz-topbar__menu zz-menu-root">
          <Button
            variant="ghost"
            className="zz-target-switch"
            data-testid="target-switch"
            aria-haspopup="menu"
            aria-expanded={menu === "targets"}
            disabled={!workspace?.configured}
            onClick={() => setMenu(menu === "targets" ? "" : "targets")}
          >
            <BookOpen size={15} aria-hidden="true" />
            <span className="zz-target-switch__label" data-testid="target-label">
              {selected?.label ?? C.topbar.pickTarget}
            </span>
            <ChevronDown size={14} aria-hidden="true" />
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
        {views.length > 1 ? (
          <>
            <span className="zz-topbar__divider" aria-hidden="true" />
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
          </>
        ) : null}
        <span className="zz-topbar__spacer" />
        {head ? (
          <RunPill head={head} extra={Math.max(0, runs.length - 1)} />
        ) : running.length ? (
          <button
            type="button"
            className="zz-run-pill"
            data-testid="running-indicator"
            data-state="running"
            onClick={() => openPipeline()}
          >
            <i aria-hidden="true" />
            <span className="zz-run-pill__detail">{C.topbar.running(running.length)}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="zz-model-status"
          data-testid="model-status"
          data-ready={ready}
          title={ready ? C.topbar.modelReady : C.topbar.modelMissing}
          onClick={() => openSettings("models")}
        >
          <i aria-hidden="true" />
          <span>{ready ? C.topbar.modelReady : C.topbar.modelMissing}</span>
        </button>
        <div className="zz-topbar__tools">
          <IconButton
            label={C.topbar.commandPalette}
            data-testid="open-palette"
            icon={<Command size={15} />}
            onClick={() => set({ paletteOpen: true })}
          />
          {selected && view === "writing" ? (
            <IconButton
              label={zenMode ? C.topbar.zenExit : C.topbar.zenMode}
              pressed={zenMode}
              data-testid="zen-toggle"
              icon={zenMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              onClick={() => set({ zenMode: !zenMode })}
            />
          ) : null}
          {selected ? (
            <div className="zz-topbar__menu zz-menu-root">
              <IconButton
                label={C.topbar.export}
                data-testid="export-menu"
                aria-haspopup="menu"
                aria-expanded={menu === "export"}
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
          {selected && view !== "hub" && view !== "warehouse" ? (
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
        </div>
      </header>
      <GlobalRail />
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
