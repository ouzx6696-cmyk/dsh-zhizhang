import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pen, Send } from "lucide-react";
import { COPY, DESKTOP_COPY as C, WORKBENCH_COPY as W } from "@zhizhang/ui/copy";
import { Button, Empty, Skeleton, StatusChip } from "@zhizhang/ui/primitives";
import { TOUTIAO_DELIVERED, statusChipTone, statusLabel } from "@zhizhang/ui/status";
import { ARTICLE_TRANSITIONS, type ArticleStatus } from "@zhizhang/toutiao/status";
import type { ArticleRowView } from "@zhizhang/toutiao/view";
import {
  ArticleList,
  ArticleProgress,
  Manuscript,
  SourceEditor,
  useToutiao,
  type ToutiaoAction,
} from "@zhizhang/workbench/client";
import { articleDraftKey } from "@zhizhang/workbench/editor";
import type { Target } from "../../../shared/views";
import { canLeave, select, trackEditor } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { baseName, desktopStore, joinPath, useDesktop } from "../../state/store";
import { notifyError, run } from "../../format";
import { TextField } from "./TextField";

const set = desktopStore.set;

interface DraftState {
  status: "loading" | "ready" | "error";
  title: string;
  body: string;
  revision: string;
  file: string;
  error: string;
}

const EMPTY_DRAFT: DraftState = {
  status: "loading",
  title: "",
  body: "",
  revision: "",
  file: "",
  error: "",
};

/** 当前状态允许的下一步（不含交稿：交稿走“生成交稿单”，带固定末句与质检门禁）。 */
export function nextStatuses(status: ArticleStatus): ArticleStatus[] {
  return ARTICLE_TRANSITIONS[status].filter((to) => to !== TOUTIAO_DELIVERED);
}

function DraftPanel({
  articleDir,
  row,
  readonly,
  revision,
  onTransition,
  onDeliver,
  busy,
  progress,
}: {
  articleDir: string;
  row: ArticleRowView;
  readonly: boolean;
  revision: number;
  onTransition: (to: ArticleStatus) => void;
  onDeliver: (title: string, body: string) => void;
  busy: boolean;
  progress?: React.ReactNode;
}) {
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const position = useRef(0);

  const load = useCallback(async () => {
    try {
      const value = await desktop.workbench("toutiao.draft.get", { articleDir });
      setDraft({ status: "ready", error: "", ...value });
    } catch (error) {
      setDraft({
        ...EMPTY_DRAFT,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [articleDir]);

  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setEditing(false);
    void load();
  }, [load, revision]);

  const save = async (text: string, base: string) => {
    const saved = await desktop.workbench("toutiao.draft.save", {
      articleDir,
      title: title.trim() || undefined,
      body: text,
      ...(base ? { revision: base } : {}),
    });
    setDraft((current) => ({
      ...current,
      title: title.trim(),
      body: text.trim(),
      revision: saved.revision,
    }));
    setEditing(false);
  };

  const status = row.status;
  const transitions = nextStatuses(status);
  const shownTitle = draft.title || row.title || row.id;
  const words = draft.body.replace(/\s+/g, "").length;
  const actions = (
    <>
      {transitions.map((to) => (
        <Button
          key={to}
          size="sm"
          variant="ghost"
          data-testid="article-transition"
          data-to={to}
          disabled={readonly || busy}
          onClick={() => onTransition(to)}
        >
          {C.toutiao.moveTo(statusLabel("toutiao", to))}
        </Button>
      ))}
      {ARTICLE_TRANSITIONS[status].includes(TOUTIAO_DELIVERED) ? (
        <Button
          size="sm"
          variant="primary"
          data-testid="article-deliver"
          disabled={readonly || busy || !draft.body}
          onClick={() => onDeliver(shownTitle, draft.body)}
        >
          <Send size={14} aria-hidden="true" />
          {COPY["toutiao.action.deliver"]}
        </Button>
      ) : null}
    </>
  );
  const lead = (
    <>
      <span className="wb-bar-ordinal">{C.toutiao.draft}</span>
      <StatusChip
        tone={statusChipTone("toutiao", status)}
        label={statusLabel("toutiao", status)}
        dot
      />
      <span className="zz-hidden-value" data-testid="article-status">
        {status}
      </span>
    </>
  );
  return (
    <section className="zz-draft" data-testid="draft-panel" aria-label={C.toutiao.draft}>
      {draft.status === "loading" ? (
        <div className="wb-reader-body">
          <div className="wb-manuscript">
            <Skeleton lines={8} />
          </div>
        </div>
      ) : draft.status === "error" ? (
        <Empty title={C.toutiao.draftFailed} description={draft.error} />
      ) : editing ? (
        <div className="zz-draft__editor wb-sheet--article" data-testid="draft-editor">
          <SourceEditor
            extra={
              <div className="zz-draft__title-field">
                <TextField
                  label={C.toutiao.draftTitle}
                  value={title}
                  onChange={setTitle}
                  testId="draft-title"
                />
              </div>
            }
            initial={draft.body}
            title={C.toutiao.draft}
            lead={lead}
            draftKey={articleDraftKey({ root: articleDir, id: row.id })}
            baseRevision={draft.revision}
            position={position}
            onSave={save}
            onCancel={() => setEditing(false)}
            onStateChange={trackEditor}
          />
        </div>
      ) : (
        <div className="wb-reader wb-sheet--article">
          <header className="wb-bar">
            <div className="wb-bar-lead">{lead}</div>
            <div className="wb-bar-actions">
              <Button
                size="sm"
                data-testid="draft-edit"
                disabled={readonly}
                onClick={() => {
                  setTitle(draft.title || row.title);
                  setEditing(true);
                }}
              >
                <Pen size={14} aria-hidden="true" />
                {draft.file ? C.toutiao.editDraft : C.toutiao.writeDraft}
              </Button>
              {actions ? <span className="zz-bar-divider" aria-hidden="true" /> : null}
              {actions}
            </div>
          </header>
          {progress}
          <div className="wb-reader-body" data-testid="draft-body">
            <Manuscript text={draft.body} title={shownTitle} emptyText={C.toutiao.draftEmpty} />
          </div>
          <footer className="wb-statusbar">
            <span className="wb-statusbar-item">{W.editor.words(words)}</span>
          </footer>
        </div>
      )}
    </section>
  );
}

function Ledger({
  rows,
  onOpen,
}: {
  rows: readonly ArticleRowView[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="zz-board" data-testid="board" aria-label={C.topbar.viewLedger}>
      {rows.length ? (
        <table className="zz-table">
          <thead>
            <tr>
              <th>{C.toutiao.title}</th>
              <th>{C.toutiao.genre}</th>
              <th>{C.toutiao.qa}</th>
              <th>{C.fanqie.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                data-testid="board-row"
                data-article-id={row.id}
                data-status={row.status}
              >
                <td>
                  <button type="button" className="zz-link" onClick={() => onOpen(row.id)}>
                    {row.title || row.id}
                  </button>
                </td>
                <td>{row.genre}</td>
                <td>{row.qaScore ?? "—"}</td>
                <td>{statusLabel("toutiao", row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title={C.toutiao.emptyLedger} />
      )}
    </section>
  );
}

export function ToutiaoWorkspace({ target, readonly }: { target: Target; readonly: boolean }) {
  const root = useDesktop((s) => s.workspace?.roots.toutiao ?? "");
  const mainView = useDesktop((s) => s.view);
  const revision = useDesktop((s) => s.revisions.article);
  const toutiao = useToutiao(root);
  const { state, rows, selected, dispatch, refresh } = toutiao;
  const articleId = baseName(target.path);

  useEffect(() => {
    if (state.selectedId !== articleId) dispatch({ type: "select", id: articleId });
  }, [articleId, state.selectedId, dispatch]);

  const firstRevision = useRef(true);
  useEffect(() => {
    if (firstRevision.current) {
      firstRevision.current = false;
      return;
    }
    void refresh();
  }, [revision, refresh]);

  useEffect(() => {
    set({ focus: { article: articleId, title: selected?.title, source: "article" } });
  }, [articleId, selected?.title]);

  useEffect(() => () => trackEditor(null), []);

  const open = (id: string) =>
    run(async () => {
      if (id === articleId) return set({ view: "writing" });
      if (!(await canLeave())) return;
      await select({ mode: "toutiao", path: joinPath(root, id) }, {}, false);
    });

  const routed = (action: ToutiaoAction) => {
    if (action.type === "select") open(action.id);
    else dispatch(action);
  };

  return (
    <div className="zz-workspace zz-workspace--toutiao">
      <nav className="zz-workspace__nav" aria-label={W.list.articleNav}>
        <header className="zz-nav-head">
          <h2>
            {C.topbar.articles}
            <span className="zz-nav-head__count">{rows.length}</span>
          </h2>
        </header>
        <div className="zz-nav-body">
          <ArticleList state={state} rows={rows} dispatch={routed} />
        </div>
      </nav>
      <section className="zz-workspace__center">
        {mainView === "board" ? (
          <div className="zz-center-scroll">
            <Ledger rows={rows} onOpen={open} />
          </div>
        ) : selected ? (
          <DraftPanel
            articleDir={target.path}
            row={selected}
            readonly={readonly}
            revision={revision}
            busy={Boolean(state.busyAction)}
            progress={<ArticleProgress state={state} selected={selected} />}
            onTransition={(to) => run(() => toutiao.transitionArticle(target.path, to))}
            onDeliver={(title, body) =>
              toutiao.deliverArticle(target.path, title, body).catch(notifyError)
            }
          />
        ) : (
          <Empty title={W.toutiao.pick} description={W.toutiao.pickHint} />
        )}
      </section>
    </div>
  );
}
