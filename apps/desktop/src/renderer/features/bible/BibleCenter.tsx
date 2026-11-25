import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { Button, Empty, Notice, Skeleton } from "@zhizhang/ui/primitives";
import type { AuditFinding, Bible, BibleView, EntityTimelineResult } from "@zhizhang/fanqie/bible";
import type { LearningView, Target } from "../../../shared/views";
import { modelReady, openDock, sendMessage } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
import { errorText, notifyError } from "../../format";
import {
  BibleKnowledgeTab,
  BibleLearningTab,
  BiblePendingTab,
  BibleTraceTab,
} from "./BibleCenterTabs";

const C = DESKTOP_COPY;
type BibleTab = "entities" | "threads" | "knowledge" | "pending" | "learning" | "trace";

export function BibleCenter({ target }: { target: Target }) {
  const work = target.path;
  const revision = useDesktop((s) => s.revisions.bible);
  const chapters = useDesktop((s) => s.chapters);
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const settings = useDesktop((s) => s.settings);

  const [tab, setTab] = useState<BibleTab>("entities");
  const [bible, setBible] = useState<Bible | null>(null);
  const [snapshot, setSnapshot] = useState<BibleView | null>(null);
  const [asOf, setAsOf] = useState(0);
  const [query, setQuery] = useState("");
  const [findings, setFindings] = useState<AuditFinding[] | null>(null);
  const [traceResult, setTraceResult] = useState<EntityTimelineResult | null>(null);
  const [learning, setLearning] = useState<LearningView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const maxChapter = Math.max(chapters.length, bible?.chapters.length ?? 0);

  const load = useCallback(async () => {
    try {
      const [nextBible, nextLearning] = await Promise.all([
        desktop.workbench("fanqie.bible.get", { work }),
        desktop.learning(target).catch(() => null),
      ]);
      setBible(nextBible);
      setLearning(nextLearning);
      setError("");
    } catch (err) {
      setError(errorText(err));
    }
  }, [work, target]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  useEffect(() => {
    if (asOf <= 0) {
      setSnapshot(null);
      return;
    }
    let alive = true;
    desktop
      .workbench("fanqie.bible.view", { work, position: asOf })
      .then((view) => alive && setSnapshot(view))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work, asOf, revision]);

  const decide = async (id: string, decision: "accept" | "reject") => {
    setBusy(id);
    try {
      await desktop.workbench("fanqie.bible.decide", { work, id, decision });
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const runAudit = async () => {
    setBusy("audit");
    try {
      const res = await desktop.workbench("fanqie.bible.audit", {
        work,
        upTo: Math.max(1, maxChapter),
      });
      setFindings(res.findings);
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const runTrace = async (traceQuery: string, includeBody: boolean) => {
    setBusy("trace");
    try {
      const res = await desktop.workbench("fanqie.bible.trace", {
        work,
        query: traceQuery,
        includeBody,
      });
      setTraceResult(res);
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const jumpChapter = (chapterIndex: number, chapterId?: string) => {
    const ch = chapterId ? chapters.find((c) => c.id === chapterId) : chapters[chapterIndex - 1];
    desktopStore.set({
      view: "writing",
      ...(ch ? { jumpChapterId: ch.id } : {}),
    });
  };

  const askAssistantAudit = async () => {
    openDock("assistant");
    if (!modelReady(settings)) return;
    try {
      await sendMessage(C.cowriter.quickDiagnoseText, "diagnose");
    } catch (err) {
      notifyError(err);
    }
  };

  const activeEntities = useMemo(
    () => (snapshot ? snapshot.entities : (bible?.entities ?? [])),
    [snapshot, bible],
  );
  const activeStates = snapshot ? snapshot.states : (bible?.states ?? []);
  const activeThreads = snapshot ? snapshot.threads : (bible?.threads ?? []);
  const activeKnowledge = snapshot ? snapshot.knowledge : (bible?.knowledge ?? []);

  const filteredEntities = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeEntities;
    return activeEntities.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [activeEntities, query]);

  if (error) {
    return (
      <section className="zz-center-page" data-testid="bible-center">
        <Notice tone="bad" message={error} />
      </section>
    );
  }
  if (!bible) {
    return (
      <section className="zz-center-page" data-testid="bible-center">
        <Skeleton lines={10} />
      </section>
    );
  }

  const openThreadsCount = bible.threads.filter((t) => t.status === "open").length;
  const tabs: { id: BibleTab; label: string; count?: number }[] = [
    { id: "entities", label: C.bibleCenter.tabEntities, count: activeEntities.length },
    { id: "threads", label: C.bibleCenter.tabThreads, count: openThreadsCount },
    { id: "knowledge", label: C.bibleCenter.tabKnowledge, count: activeKnowledge.length },
    { id: "pending", label: C.bibleCenter.tabPending, count: bible.pending.length },
    { id: "learning", label: C.bibleCenter.tabLearning, count: learning?.rules.length ?? 0 },
    { id: "trace", label: C.bibleCenter.tabTrace, count: traceResult?.events.length },
  ];

  return (
    <section
      className="zz-center-page zz-bible-center"
      data-testid="bible-center"
      aria-label={C.bibleCenter.title}
    >
      <header className="zz-page-head">
        <div>
          <h1>{C.bibleCenter.title}</h1>
          <p className="zz-muted">
            {C.bible.stats(bible.entities.length, openThreadsCount, bible.knowledge.length)}
          </p>
        </div>
        {maxChapter > 0 && (tab === "entities" || tab === "threads" || tab === "knowledge") ? (
          <label className="zz-timeline-scrub">
            <span>{asOf > 0 ? C.bibleCenter.asOfLabel(asOf) : C.bibleCenter.allChapters}</span>
            <input
              type="range"
              min={0}
              max={maxChapter}
              value={asOf}
              onChange={(e) => setAsOf(Number(e.target.value))}
            />
          </label>
        ) : null}
      </header>

      <nav className="zz-page-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            data-testid={`bible-tab-${item.id}`}
            className="zz-page-tab"
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count !== undefined ? <span className="zz-tabular">{item.count}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "entities" ? (
        <div className="zz-bible-center__body">
          <div className="zz-hub__search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={C.bibleCenter.searchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {filteredEntities.length ? (
            <div className="zz-card-grid">
              {filteredEntities.map((entity) => {
                const states = activeStates.filter(
                  (s) => s.entity === entity.id || s.entity === entity.name,
                );
                return (
                  <article key={entity.id} className="zz-entity-card">
                    <header className="zz-entity-card__head">
                      <strong>{entity.name}</strong>
                      <span className="zz-meta-tag">{entity.kind}</span>
                    </header>
                    {entity.aliases.length ? (
                      <p className="zz-muted">{entity.aliases.join(" / ")}</p>
                    ) : null}
                    <p>{entity.summary}</p>
                    {states.length ? (
                      <ul className="zz-state-list">
                        {states.slice(0, 4).map((st) => (
                          <li key={st.id}>
                            <span>{st.field}</span>
                            <strong>{st.value}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty title={C.bibleCenter.emptyEntities} />
          )}
        </div>
      ) : null}

      {tab === "threads" ? (
        <div className="zz-bible-center__body">
          {activeThreads.length ? (
            <div className="zz-card-grid">
              {activeThreads.map((thread) => (
                <article key={thread.id} className="zz-entity-card" data-status={thread.status}>
                  <header className="zz-entity-card__head">
                    <strong>{thread.title}</strong>
                    <span className="zz-meta-tag">
                      {thread.status === "open"
                        ? C.bibleCenter.threadOpen
                        : C.bibleCenter.threadClosed}
                    </span>
                  </header>
                  <p className="zz-muted zz-tabular">
                    {C.bibleCenter.threadOpenedAt(thread.opened)}
                    {thread.plannedPayoff
                      ? ` · ${C.bibleCenter.threadPlanned(thread.plannedPayoff)}`
                      : ""}
                  </p>
                  {chapters.length >= thread.opened ? (
                    <Button size="sm" variant="ghost" onClick={() => jumpChapter(thread.opened)}>
                      {C.bibleCenter.jumpChapter}
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </Button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <Empty title={C.bibleCenter.emptyThreads} />
          )}
        </div>
      ) : null}

      {tab === "knowledge" ? <BibleKnowledgeTab items={activeKnowledge} /> : null}

      {tab === "pending" ? (
        <BiblePendingTab
          pending={bible.pending}
          findings={findings}
          maxChapter={maxChapter}
          readonly={readonly}
          busy={busy}
          onRunAudit={() => void runAudit()}
          onAskAssistantAudit={() => void askAssistantAudit()}
          onDecide={(id, decision) => void decide(id, decision)}
        />
      ) : null}

      {tab === "learning" ? <BibleLearningTab learning={learning} /> : null}

      {tab === "trace" ? (
        <BibleTraceTab
          result={traceResult}
          busy={busy === "trace"}
          onTrace={(q, body) => void runTrace(q, body)}
          onJumpChapter={(pos, cid) => jumpChapter(pos, cid)}
        />
      ) : null}
    </section>
  );
}
