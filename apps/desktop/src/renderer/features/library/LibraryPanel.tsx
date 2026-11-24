import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BookMarked, Link2, Plus, Sparkles, Upload } from "lucide-react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, Empty, Skeleton } from "@zhizhang/ui/primitives";
import type { TechniqueCardView } from "@zhizhang/workbench/contract";
import { desktop } from "../../state/desktop";
import { useDesktop } from "../../state/store";
import { notifyError } from "../../format";
import { TechniqueCardTile } from "./TechniqueCardTile";

const C = DESKTOP_COPY;

interface SourceRow {
  id: string;
  title: string;
  importedAt: string;
  hasReport: boolean;
  cardCount: number;
}

export function LibraryPanel({
  onOpenEditor,
}: {
  onOpenEditor?: (sourceId: string, cardId?: string) => void;
}) {
  const libraryRoot = useDesktop((s) => s.workspace?.roots.library ?? "");
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const selected = useDesktop((s) => s.selected);
  const focusChapter = useDesktop((s) => s.focus.chapter ?? "");
  const revision = useDesktop((s) => s.revisions.library);

  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [activeId, setActiveId] = useState("");
  const [cards, setCards] = useState<TechniqueCardView[]>([]);
  const [report, setReport] = useState("");
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState("");

  const loadSources = useCallback(async () => {
    if (!libraryRoot) return;
    try {
      const res = await desktop.workbench("library.list", { libraryRoot });
      setSources(res.sources);
      if (!activeId && res.sources[0]) setActiveId(res.sources[0].id);
    } catch (err) {
      notifyError(err);
    }
  }, [libraryRoot, activeId]);

  useEffect(() => {
    void loadSources();
  }, [loadSources, revision]);

  const loadCards = useCallback(async () => {
    if (!libraryRoot || !activeId) {
      setCards([]);
      setReport("");
      return;
    }
    try {
      const res = await desktop.workbench("library.cards", { libraryRoot, sourceId: activeId });
      setCards(res.cards);
      setReport(res.report ?? "");
    } catch (err) {
      notifyError(err);
    }
  }, [libraryRoot, activeId]);

  useEffect(() => {
    void loadCards();
  }, [loadCards, revision]);

  const importSource = async () => {
    if (!libraryRoot || !title.trim() || !content.trim()) return;
    setBusy("import");
    try {
      const id = `src-${Date.now().toString(36)}`;
      await desktop.workbench("library.import", {
        libraryRoot,
        id,
        title: title.trim(),
        content: content.trim(),
      });
      setTitle("");
      setContent("");
      setActiveId(id);
      notify({ tone: "success", text: C.warehouse.importDone });
      await loadSources();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const dissect = async (source: SourceRow) => {
    if (!libraryRoot) return;
    setBusy(`dissect:${source.id}`);
    try {
      const res = await desktop.workbench("library.dissect", {
        libraryRoot,
        sourceId: source.id,
        title: source.title,
      });
      notify({ tone: "success", text: C.warehouse.dissectDone(res.cardCount) });
      await loadSources();
      await loadCards();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const bindCards = async (scope: "work" | "chapter", cardIds?: string[]) => {
    if (!selected || selected.target.mode !== "fanqie" || !activeId) {
      notify({ tone: "warning", text: C.warehouse.noActiveWork });
      return;
    }
    setBusy(`bind:${scope}`);
    try {
      const res = await desktop.workbench("fanqie.reference.bind", {
        work: selected.target.path,
        sourceId: activeId,
        ...(cardIds ? { cardIds } : {}),
        scope,
        ...(scope === "chapter" && focusChapter ? { chapterId: focusChapter } : {}),
      });
      notify({ tone: "success", text: C.warehouse.boundOk(res.boundCount) });
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const categories = useMemo(
    () => Array.from(new Set(cards.map((c) => c.category).filter(Boolean))),
    [cards],
  );
  const visibleCards = useMemo(
    () => (category ? cards.filter((c) => c.category === category) : cards),
    [cards, category],
  );
  const activeSource = sources?.find((s) => s.id === activeId) ?? null;

  return (
    <div className="zz-warehouse-grid" data-testid="warehouse-library">
      <aside className="zz-warehouse-side">
        <section className="zz-panel-box">
          <h3>{C.warehouse.importTitle}</h3>
          <input
            type="text"
            className="zz-input"
            value={title}
            disabled={readonly || busy !== ""}
            placeholder={C.warehouse.sourceTitlePlaceholder}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="zz-textarea"
            rows={4}
            value={content}
            disabled={readonly || busy !== ""}
            placeholder={C.warehouse.sourceContentPlaceholder}
            onChange={(e) => setContent(e.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            loading={busy === "import"}
            disabled={readonly || !title.trim() || !content.trim()}
            onClick={() => void importSource()}
          >
            <Upload size={13} aria-hidden="true" />
            {C.warehouse.importSubmit}
          </Button>
        </section>

        <section className="zz-panel-box">
          <h3>{C.warehouse.sourcesList}</h3>
          {!sources ? (
            <Skeleton lines={4} />
          ) : sources.length ? (
            <ul className="zz-source-list">
              {sources.map((src) => (
                <li key={src.id}>
                  <button
                    type="button"
                    className="zz-source-row"
                    data-active={src.id === activeId}
                    onClick={() => {
                      setActiveId(src.id);
                      setCategory("");
                    }}
                  >
                    <strong>{src.title}</strong>
                    <span className="zz-tabular">{src.cardCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="zz-muted">{C.warehouse.emptySources}</p>
          )}
        </section>
      </aside>

      <div className="zz-warehouse-main">
        {activeSource ? (
          <>
            <header className="zz-warehouse-bar">
              <div>
                <h2>{activeSource.title}</h2>
                <span className="zz-muted">{C.warehouse.cardsTitle}</span>
              </div>
              <div className="zz-row">
                <Button
                  size="sm"
                  loading={busy === `dissect:${activeSource.id}`}
                  disabled={readonly || busy !== ""}
                  onClick={() => void dissect(activeSource)}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  {C.warehouse.dissectAction}
                </Button>
                {onOpenEditor ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={readonly}
                    onClick={() => onOpenEditor(activeSource.id)}
                  >
                    <Plus size={13} aria-hidden="true" />
                    {C.warehouse.newCard}
                  </Button>
                ) : null}
                {cards.length > 0 ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={readonly || busy !== ""}
                      onClick={() => void bindCards("work")}
                    >
                      <Link2 size={13} aria-hidden="true" />
                      {C.warehouse.bindToWork}
                    </Button>
                    {focusChapter ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={readonly || busy !== ""}
                        onClick={() => void bindCards("chapter")}
                      >
                        <BookMarked size={13} aria-hidden="true" />
                        {C.warehouse.bindToChapter}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </header>

            {categories.length > 1 ? (
              <div className="zz-filter-bar">
                <button
                  type="button"
                  className="zz-filter-btn"
                  aria-pressed={category === ""}
                  onClick={() => setCategory("")}
                >
                  {C.warehouse.filterCategoryAll}
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className="zz-filter-btn"
                    aria-pressed={category === cat}
                    onClick={() => setCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            ) : null}

            {visibleCards.length ? (
              <div className="zz-card-grid">
                {visibleCards.map((card) => (
                  <TechniqueCardTile
                    key={card.id}
                    card={card}
                    sourceId={activeSource.id}
                    readonly={readonly}
                    busy={busy !== ""}
                    hasChapter={Boolean(focusChapter)}
                    onEdit={onOpenEditor}
                    onBind={(scope, ids) => void bindCards(scope, ids)}
                  />
                ))}
              </div>
            ) : (
              <Empty title={C.warehouse.emptyCards} />
            )}

            {report ? (
              <details className="zz-report-box">
                <summary>{C.warehouse.reportTitle}</summary>
                <pre className="zz-report-pre">{report}</pre>
              </details>
            ) : null}
          </>
        ) : (
          <Empty title={C.warehouse.emptySources} />
        )}
      </div>
    </div>
  );
}
