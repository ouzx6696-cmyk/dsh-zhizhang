import React, { useMemo, useState } from "react";
import { BookOpen, FileText, Library, Plus, Search, Settings2 } from "lucide-react";
import { COPY, DESKTOP_COPY } from "@zhizhang/ui/copy";
import { Brand, Button, Empty } from "@zhizhang/ui/primitives";
import { statusLabel } from "@zhizhang/ui/status";
import type { TargetItem } from "../../../shared/views";
import { openSettings, select, startCreate } from "../../state/controller";
import { desktopStore, sameTarget, useDesktop } from "../../state/store";
import { run } from "../../format";

const C = DESKTOP_COPY;
type ModeFilter = "all" | "work" | "article";

function openTarget(item: TargetItem) {
  run(async () => {
    await select(item.target);
    desktopStore.set({ view: "writing" });
  });
}

function ProjectCard({ item, active }: { item: TargetItem; active: boolean }) {
  const isWork = item.kind === "work";
  return (
    <button
      type="button"
      className="zz-hub-card"
      data-testid="hub-card"
      data-kind={item.kind}
      data-active={active}
      onClick={() => openTarget(item)}
    >
      <div className="zz-hub-card__head">
        <span className="zz-hub-card__kind">
          {isWork ? (
            <BookOpen size={14} aria-hidden="true" />
          ) : (
            <FileText size={14} aria-hidden="true" />
          )}
          {isWork ? C.topbar.works : item.genre || C.topbar.articles}
        </span>
        {item.status ? (
          <span className="zz-hub-card__meta">{statusLabel("toutiao", item.status)}</span>
        ) : item.profile ? (
          <span className="zz-hub-card__meta">{C.hub.profileTag(item.profile)}</span>
        ) : null}
      </div>
      <strong className="zz-hub-card__title">{item.label}</strong>
      <div className="zz-hub-card__foot">
        {isWork ? (
          <>
            <span>{C.hub.chaptersCount(item.chapterCount ?? 0, item.finalCount ?? 0)}</span>
            <span>{C.hub.wordsLabel(item.wordCount ?? 0)}</span>
            {item.pendingBible ? (
              <span className="zz-hub-card__alert">{C.hub.pendingBadge(item.pendingBible)}</span>
            ) : null}
          </>
        ) : (
          <>
            {item.qaScore !== undefined ? <span>{C.hub.qaBadge(item.qaScore)}</span> : null}
            {item.updated ? <span>{item.updated.slice(0, 10)}</span> : null}
          </>
        )}
      </div>
    </button>
  );
}

/** 工作区项目总览 Hub：聚合长篇作品、头条文章、累计统计与快捷操作。 */
export function ProjectHub() {
  const workspace = useDesktop((s) => s.workspace);
  const targets = useDesktop((s) => s.targets);
  const selected = useDesktop((s) => s.selected);
  const recent = useDesktop((s) => s.app?.recent ?? []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ModeFilter>("all");

  const works = useMemo(() => targets.filter((t) => t.kind === "work"), [targets]);
  const articles = useMemo(() => targets.filter((t) => t.kind === "article"), [targets]);
  const totalWords = useMemo(
    () => works.reduce((sum, item) => sum + (item.wordCount ?? 0), 0),
    [works],
  );
  const totalPending = useMemo(
    () => works.reduce((sum, item) => sum + (item.pendingBible ?? 0), 0),
    [works],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return targets.filter((item) => {
      if (filter !== "all" && item.kind !== filter) return false;
      if (!q) return true;
      return (
        item.label.toLowerCase().includes(q) ||
        (item.genre ?? "").toLowerCase().includes(q) ||
        (item.status ?? "").toLowerCase().includes(q)
      );
    });
  }, [targets, filter, query]);

  if (!workspace?.configured) {
    return (
      <div className="zz-empty-page" data-testid="welcome">
        <Brand label={COPY["app.name"]} className="zz-brand--lg" />
        <h1>{C.shell.welcomeTitle}</h1>
        <p>{C.shell.welcomeSetup}</p>
        <div className="zz-row">
          <Button variant="primary" onClick={() => openSettings("workspace")}>
            {C.hub.openSettings}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <main className="zz-hub" data-testid="project-hub" aria-label={C.hub.title}>
      <div className="zz-hub__inner">
        <header className="zz-hub__header">
          <div>
            <h1>{C.hub.title}</h1>
            <p className="zz-muted">{C.hub.subtitle}</p>
          </div>
          <div className="zz-row">
            <Button
              variant="ghost"
              data-testid="hub-open-warehouse"
              onClick={() => desktopStore.set({ view: "warehouse" })}
            >
              <Library size={15} aria-hidden="true" />
              {C.hub.openWarehouse}
            </Button>
            <Button
              variant="ghost"
              data-testid="welcome-new-article"
              onClick={() => startCreate("toutiao")}
            >
              <Plus size={15} aria-hidden="true" />
              {C.create.newArticle}
            </Button>
            <Button
              variant="primary"
              data-testid="welcome-new-work"
              onClick={() => startCreate("fanqie")}
            >
              <Plus size={15} aria-hidden="true" />
              {C.create.newWork}
            </Button>
          </div>
        </header>

        <section className="zz-hub__stats" aria-label={C.hub.title}>
          <div className="zz-hub-stat">
            <span>{C.hub.statWorks}</span>
            <strong>{works.length}</strong>
          </div>
          <div className="zz-hub-stat">
            <span>{C.hub.statArticles}</span>
            <strong>{articles.length}</strong>
          </div>
          <div className="zz-hub-stat">
            <span>{C.hub.statWords}</span>
            <strong>{totalWords.toLocaleString("zh-CN")}</strong>
          </div>
          <div className="zz-hub-stat">
            <span>{C.hub.statPending}</span>
            <strong>{totalPending}</strong>
          </div>
        </section>

        {recent.length > 0 ? (
          <section className="zz-hub__section">
            <h2 className="zz-hub__section-title">{C.hub.recentTitle}</h2>
            <div className="zz-hub__grid">
              {recent.slice(0, 3).map((item) => (
                <ProjectCard
                  key={`recent:${item.target.mode}:${item.target.path}`}
                  item={targets.find((t) => sameTarget(t.target, item.target)) ?? item}
                  active={sameTarget(item.target, selected?.target)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="zz-hub__section">
          <div className="zz-hub__toolbar">
            <div className="zz-hub__search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                aria-label={C.hub.searchPlaceholder}
                placeholder={C.hub.searchPlaceholder}
                data-testid="hub-search"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="zz-filter-bar" role="group" aria-label={C.topbar.views}>
              {(
                [
                  ["all", C.hub.filterAll],
                  ["work", C.hub.filterWork],
                  ["article", C.hub.filterArticle],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="zz-filter-btn"
                  aria-pressed={filter === id}
                  data-testid={`hub-filter-${id}`}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => openSettings("workspace")}>
              <Settings2 size={14} aria-hidden="true" />
              {C.hub.openSettings}
            </Button>
          </div>

          {filtered.length > 0 ? (
            <div className="zz-hub__grid" data-testid="hub-grid">
              {filtered.map((item) => (
                <ProjectCard
                  key={`${item.target.mode}:${item.target.path}`}
                  item={item}
                  active={sameTarget(item.target, selected?.target)}
                />
              ))}
            </div>
          ) : (
            <Empty title={C.hub.emptyTitle} description={C.hub.emptyHint} />
          )}
        </section>
      </div>
    </main>
  );
}
