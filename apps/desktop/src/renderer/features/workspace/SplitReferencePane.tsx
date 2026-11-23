import React, { useEffect, useState } from "react";
import { BookOpen, Layers } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, Skeleton } from "@zhizhang/ui/primitives";
import { statusLabel } from "@zhizhang/ui/status";
import type { Bible } from "@zhizhang/fanqie/bible";
import type { ArticleRowView } from "@zhizhang/toutiao/view";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
import { notifyError } from "../../format";

export function FanqieSplitReference({ work }: { work: string }) {
  const revision = useDesktop((s) => s.revisions.bible);
  const [bible, setBible] = useState<Bible | null>(null);

  useEffect(() => {
    let alive = true;
    desktop
      .workbench("fanqie.bible.get", { work })
      .then((value) => alive && setBible(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work, revision]);

  const openThreads = bible ? bible.threads.filter((t) => t.status === "open") : [];
  return (
    <aside
      className="zz-split-ref"
      data-testid="split-reference-fanqie"
      aria-label={C.split.fanqieTitle}
    >
      <header className="zz-split-ref__head">
        <h3>{C.split.fanqieTitle}</h3>
        <div className="zz-split-ref__links">
          <Button size="sm" variant="ghost" onClick={() => desktopStore.set({ view: "bible" })}>
            <BookOpen size={13} aria-hidden="true" />
            {C.split.openBibleCenter}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => desktopStore.set({ view: "warehouse" })}>
            <Layers size={13} aria-hidden="true" />
            {C.split.openWarehouse}
          </Button>
        </div>
      </header>
      <div className="zz-split-ref__body">
        {!bible ? (
          <Skeleton lines={6} />
        ) : (
          <>
            <section className="zz-split-ref__section">
              <h4>{C.split.entitiesTitle}</h4>
              {bible.entities.length ? (
                <ul className="zz-ref-list">
                  {bible.entities.slice(0, 12).map((entity) => (
                    <li key={entity.id} className="zz-ref-item">
                      <strong>{entity.name}</strong>
                      <span>{entity.summary}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="zz-muted">{C.bibleCenter.emptyEntities}</p>
              )}
            </section>
            <section className="zz-split-ref__section">
              <h4>{C.split.threadsTitle}</h4>
              {openThreads.length ? (
                <ul className="zz-ref-list">
                  {openThreads.slice(0, 10).map((thread) => (
                    <li key={thread.id} className="zz-ref-item">
                      <strong>{thread.title}</strong>
                      <span>
                        {C.bibleCenter.threadOpenedAt(thread.opened)}
                        {thread.plannedPayoff
                          ? ` · ${C.bibleCenter.threadPlanned(thread.plannedPayoff)}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="zz-muted">{C.bibleCenter.emptyThreads}</p>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

export function ToutiaoSplitReference({
  articleDir,
  row,
  draftTitle,
  readonly,
}: {
  articleDir: string;
  row: ArticleRowView;
  draftTitle: string;
  readonly: boolean;
}) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  const registerSource = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const sourceId = `src-${Date.now().toString(36)}`;
      await desktop.workbench("toutiao.source.register", {
        articleDir,
        sourceId,
        kind: "paste",
        content: trimmed,
      });
      setContent("");
      setAddedCount((n) => n + 1);
      notify({ tone: "success", text: C.split.sourceAdded });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  const shownTitle = draftTitle || row.title || "";
  return (
    <aside
      className="zz-split-ref"
      data-testid="split-reference-toutiao"
      aria-label={C.split.toutiaoTitle}
    >
      <header className="zz-split-ref__head">
        <h3>{C.split.toutiaoTitle}</h3>
        <Button size="sm" variant="ghost" onClick={() => desktopStore.set({ view: "warehouse" })}>
          <Layers size={13} aria-hidden="true" />
          {C.split.openWarehouse}
        </Button>
      </header>
      <div className="zz-split-ref__body">
        <section className="zz-split-ref__section">
          <h4>{C.split.cardTitle}</h4>
          <dl className="zz-kv">
            <div>
              <dt>{C.split.genreLabel}</dt>
              <dd>{row.genre || "—"}</dd>
            </div>
            <div>
              <dt>{C.split.statusLabel}</dt>
              <dd>{statusLabel("toutiao", row.status)}</dd>
            </div>
            <div>
              <dt>{C.split.qaLabel}</dt>
              <dd className="zz-tabular">{row.qaScore ?? "—"}</dd>
            </div>
          </dl>
          {shownTitle ? (
            <p className="zz-muted zz-tabular">{C.split.titleChars(shownTitle.length)}</p>
          ) : null}
        </section>
        <section className="zz-split-ref__section">
          <h4>
            {C.split.sourcesTitle}
            {addedCount > 0 ? ` (+${addedCount})` : ""}
          </h4>
          <textarea
            className="zz-textarea"
            rows={5}
            value={content}
            disabled={readonly || busy}
            placeholder={C.split.addSourcePlaceholder}
            onChange={(e) => setContent(e.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={readonly || !content.trim()}
            onClick={() => void registerSource()}
          >
            {C.split.addSourceBtn}
          </Button>
        </section>
      </div>
    </aside>
  );
}
