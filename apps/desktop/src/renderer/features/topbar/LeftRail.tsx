import React, { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  FolderKanban,
  Library,
  Moon,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Table2,
} from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Brand, Button, IconButton, Menu } from "@zhizhang/ui/primitives";
import type { RunSummary } from "../../../shared/views";
import {
  modelReady,
  openPipeline,
  openSettings,
  saveSettings,
  select,
  startCreate,
} from "../../state/controller";
import { desktopStore, sameTarget, useDesktop, type MainView } from "../../state/store";
import { run } from "../../format";
import { QuietFooter, targetMenu } from "./LeftRailParts";

const set = desktopStore.set;

/** 左栏中部章节 / 文章列表的挂载容器 ID（由 FanqieWorkspace / ToutiaoWorkspace Portal 渲染）。 */
export const RAIL_LIST_SLOT_ID = "zz-rail-list-slot";

/** 优先级最高的一条进行中流水线：等你决定 > 失败 > 运行中 > 暂停；同级取最近更新。 */
export function headlineRun(runs: readonly RunSummary[]): RunSummary | null {
  const rank = { "awaiting-author": 0, failed: 1, running: 2, paused: 3 } as const;
  const scored = runs
    .filter((r): r is RunSummary & { state: keyof typeof rank } => r.state in rank)
    .sort((a, b) => rank[a.state] - rank[b.state] || b.updated.localeCompare(a.updated));
  return scored[0] ?? null;
}

/**
 * 柔和纸面 C2 左栏（240px，平铺在 --zz-bg 上，不做卡片边框）：
 * 品牌（中性色）→ 番茄长篇/今日头条 分段切换 → 搜索（Ctrl K）→ 当前作品封面与进度 →
 * 章节/文章列表挂载区 → 资料与视图（设定集提醒数/看板/技法仓/项目）→ 底部新流水线按钮 + 本地保存状态。
 */
export function LeftRail() {
  const selected = useDesktop((s) => s.selected);
  const targets = useDesktop((s) => s.targets);
  const view = useDesktop((s) => s.view);
  const runs = useDesktop((s) => s.runs);
  const workspace = useDesktop((s) => s.workspace);
  const settings = useDesktop((s) => s.settings);
  const [menuOpen, setMenuOpen] = useState(false);

  const ready = modelReady(settings);
  const awaiting = runs.some((r) => r.state === "awaiting-author");
  const mode = selected?.target.mode ?? "fanqie";
  const inStudio = Boolean(selected && view !== "hub" && view !== "warehouse");
  const theme = settings?.appearance.theme ?? "light";
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    document.title = awaiting ? `${C.topbar.awaitingPrefix}${COPY["app.name"]}` : COPY["app.name"];
  }, [awaiting]);

  const switchMode = (nextMode: "fanqie" | "toutiao") => {
    if (selected?.target.mode === nextMode && inStudio) return;
    const match = targets.find((t) => t.target.mode === nextMode);
    if (match) {
      run(() => select(match.target));
    } else {
      startCreate(nextMode);
    }
  };

  const toggleTheme = () => {
    if (!settings) return;
    const nextTheme = isDark ? "light" : "dark";
    run(() =>
      saveSettings({
        appearance: { ...settings.appearance, theme: nextTheme },
      }),
    );
  };

  const navTo = (nextView: MainView) => {
    set({ view: nextView, compare: null });
  };

  const chaptersTotal = selected?.chapterCount ?? 0;
  const chaptersFinal = selected?.finalCount ?? 0;
  const progressPct =
    chaptersTotal > 0 ? Math.min(100, Math.round((chaptersFinal / chaptersTotal) * 100)) : 0;
  const pendingBible = selected?.pendingBible ?? 0;

  return (
    <aside className="zz-rail" data-testid="left-rail" aria-label={C.topbar.views}>
      {/* 1. 品牌与极简设置工具 */}
      <header className="zz-rail__brand">
        <button
          type="button"
          className="zz-rail__logo-btn"
          onClick={() => navTo("hub")}
          title={C.topbar.viewHub}
        >
          <Brand label={COPY["app.name"]} />
          <span className="zz-rail__wordmark">{COPY["app.name"]}</span>
        </button>
        <div className="zz-rail__brand-tools">
          <button
            type="button"
            className="zz-model-dot"
            data-testid="model-status"
            data-ready={ready}
            title={ready ? C.topbar.modelReady : C.topbar.modelMissing}
            aria-label={ready ? C.topbar.modelReady : C.topbar.modelMissing}
            onClick={() => openSettings("models")}
          >
            <span aria-hidden="true" />
          </button>
          <IconButton
            size="xs"
            variant="ghost"
            data-testid="theme-toggle"
            label={isDark ? C.rail.themeLight : C.rail.themeDark}
            icon={isDark ? <Sun size={14} /> : <Moon size={14} />}
            onClick={toggleTheme}
          />
          <IconButton
            size="xs"
            variant="ghost"
            data-testid="open-settings"
            label={C.topbar.settings}
            icon={<SettingsIcon size={14} />}
            onClick={() => openSettings()}
          />
        </div>
      </header>

      {/* 2. 番茄长篇 / 今日头条 分段控件 */}
      <div className="zz-rail__mode" role="tablist" aria-label={C.rail.modeSwitchLabel}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "fanqie"}
          data-testid="mode-fanqie"
          className="zz-rail__mode-btn"
          onClick={() => switchMode("fanqie")}
        >
          {C.rail.modeFanqie}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "toutiao"}
          data-testid="mode-toutiao"
          className="zz-rail__mode-btn"
          onClick={() => switchMode("toutiao")}
        >
          {C.rail.modeToutiao}
        </button>
      </div>

      {/* 3. 搜索触发框（Ctrl K） */}
      <button
        type="button"
        className="zz-rail__search"
        data-testid="open-palette"
        onClick={() => set({ paletteOpen: true })}
      >
        <Search size={13} aria-hidden="true" />
        <span className="zz-rail__search-label">{C.rail.searchPlaceholder}</span>
        <kbd className="zz-rail__kbd">{C.rail.searchShortcut}</kbd>
      </button>

      {/* 4. 当前作品封面 + 进度 / 作品切换菜单 */}
      <div className="zz-rail__work zz-menu-root">
        <button
          type="button"
          className="zz-rail__work-trigger"
          data-testid="target-switch"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={!workspace?.configured}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="zz-rail__cover" aria-hidden="true">
            {selected?.label ? (
              <span>
                {selected.label.slice(0, 2)}
                {selected.label.length > 2 ? (
                  <>
                    <br />
                    {selected.label.slice(2, 4)}
                  </>
                ) : null}
              </span>
            ) : (
              <BookOpen size={14} />
            )}
          </span>
          <span className="zz-rail__work-meta">
            <strong className="zz-rail__work-title" data-testid="target-label">
              {selected?.label ?? C.topbar.pickTarget}
            </strong>
            <span className="zz-rail__work-sub">
              {selected
                ? selected.kind === "work"
                  ? C.hub.chaptersCount(chaptersTotal, chaptersFinal)
                  : selected.qaScore !== undefined
                    ? C.hub.qaBadge(selected.qaScore)
                    : selected.genre || C.topbar.articles
                : C.rail.noTargetsHint}
            </span>
            {selected?.kind === "work" && chaptersTotal > 0 ? (
              <span className="zz-rail__progress" aria-hidden="true">
                <span style={{ width: `${Math.max(progressPct, 6)}%` }} />
              </span>
            ) : null}
          </span>
          <ChevronDown size={14} className="zz-rail__chev" aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div data-testid="target-menu" className="zz-rail__target-menu">
            <Menu
              label={C.topbar.pickTarget}
              items={targetMenu(targets, selected)}
              onClose={() => setMenuOpen(false)}
            />
          </div>
        ) : null}
      </div>

      {/* 5. 章节 / 文章列表区（工作室视图由 Workspace Portal 挂载；其余视图显示最近项目） */}
      <div className="zz-rail__scroll">
        <div
          id={RAIL_LIST_SLOT_ID}
          className="zz-rail__slot"
          data-active={inStudio ? "true" : "false"}
        />
        {!inStudio ? (
          <div className="zz-rail__recent">
            <div className="zz-rail__section-head">{C.rail.recentTargets}</div>
            {targets.length ? (
              <ul className="zz-rail__recent-list">
                {targets.slice(0, 8).map((item) => (
                  <li key={item.target.mode + item.target.path}>
                    <button
                      type="button"
                      className="zz-rail__nav-link"
                      aria-current={sameTarget(item.target, selected?.target) ? "page" : undefined}
                      onClick={() => run(() => select(item.target))}
                    >
                      <span className="zz-rail__nav-text">{item.label}</span>
                      <span className="zz-rail__nav-meta">
                        {item.kind === "work"
                          ? C.fanqie.boardChapters(item.chapterCount ?? 0)
                          : item.genre || C.topbar.articles}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="zz-rail__empty">{C.rail.noTargetsHint}</p>
            )}
          </div>
        ) : null}
      </div>

      {/* 6. 资料与视图 */}
      <nav className="zz-rail__resources" aria-label={C.rail.resources}>
        <div className="zz-rail__section-head">{C.rail.resources}</div>
        {selected ? (
          <>
            <button
              type="button"
              className="zz-rail__nav-link"
              data-testid="view-writing"
              aria-current={view === "writing" ? "page" : undefined}
              onClick={() => navTo("writing")}
            >
              <BookOpen size={14} aria-hidden="true" />
              <span className="zz-rail__nav-text">{C.topbar.viewWriting}</span>
            </button>
            {selected.target.mode === "fanqie" ? (
              <button
                type="button"
                className="zz-rail__nav-link"
                data-testid="view-bible"
                aria-current={view === "bible" ? "page" : undefined}
                onClick={() => navTo("bible")}
              >
                <Sparkles size={14} aria-hidden="true" />
                <span className="zz-rail__nav-text">{C.topbar.viewBible}</span>
                {pendingBible > 0 ? (
                  <span className="zz-rail__badge-warn" data-testid="rail-bible-badge">
                    {pendingBible}
                  </span>
                ) : null}
              </button>
            ) : null}
            <button
              type="button"
              className="zz-rail__nav-link"
              data-testid="view-board"
              aria-current={view === "board" ? "page" : undefined}
              onClick={() => navTo("board")}
            >
              <Table2 size={14} aria-hidden="true" />
              <span className="zz-rail__nav-text">
                {selected.target.mode === "toutiao" ? C.topbar.viewLedger : C.topbar.viewBoard}
              </span>
            </button>
          </>
        ) : null}
        {workspace?.configured ? (
          <button
            type="button"
            className="zz-rail__nav-link"
            data-testid="view-warehouse"
            aria-current={view === "warehouse" ? "page" : undefined}
            onClick={() => navTo("warehouse")}
          >
            <Library size={14} aria-hidden="true" />
            <span className="zz-rail__nav-text">{C.topbar.viewWarehouse}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="zz-rail__nav-link"
          data-testid="view-hub"
          aria-current={view === "hub" ? "page" : undefined}
          onClick={() => navTo("hub")}
        >
          <FolderKanban size={14} aria-hidden="true" />
          <span className="zz-rail__nav-text">{C.topbar.viewHub}</span>
        </button>
      </nav>

      {/* 7. 底部：新章节流水线（次按钮）+ 静默本地保存状态 */}
      <footer className="zz-rail__foot">
        {selected ? (
          <Button
            variant="ghost"
            size="sm"
            className="zz-rail__pipeline-btn"
            data-testid="rail-start-pipeline"
            disabled={Boolean(workspace?.readonly)}
            onClick={() => openPipeline(desktopStore.get().focus.chapter ?? "")}
          >
            {selected.target.mode === "fanqie" ? C.rail.newPipeline : C.rail.newArticlePipeline}
          </Button>
        ) : null}
        <QuietFooter />
      </footer>
    </aside>
  );
}
