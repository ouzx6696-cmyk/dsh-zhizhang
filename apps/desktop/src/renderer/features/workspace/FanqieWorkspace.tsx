import React, { useEffect, useRef, useState } from "react";
import { Check, Plus, Workflow } from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Dialog, Empty, StatusChip } from "@zhizhang/ui/primitives";
import { statusLabel } from "@zhizhang/ui/status";
import { ChapterList, Dialogs, Reader, useFanqie } from "@zhizhang/workbench/client";
import type { ChapterRowView } from "@zhizhang/fanqie/view";
import type { Target } from "../../../shared/views";
import { canLeave, openPipeline, trackEditor } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
import { notifyError, run } from "../../format";
import { TextField } from "./TextField";

const set = desktopStore.set;

/** 下一个章节编号：ch-001 起按已有最大序号递增。 */
export function nextChapterId(chapters: readonly ChapterRowView[]): string {
  const max = chapters.reduce((top, c) => {
    const match = /^ch-(\d+)$/.exec(c.id);
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  return `ch-${String(Math.max(max, chapters.length) + 1).padStart(3, "0")}`;
}

function NewChapterDialog({
  work,
  chapters,
  onCreated,
  onClose,
}: {
  work: string;
  chapters: readonly ChapterRowView[];
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [id, setId] = useState(() => nextChapterId(chapters));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await desktop.workbench("fanqie.chapter.save", {
        work,
        chapter: id.trim(),
        base: "",
        body: "",
        title: title.trim() || undefined,
      });
      onCreated(id.trim());
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={C.fanqie.newChapter}
      closeLabel={COPY.close}
      size="sm"
      testId="new-chapter-dialog"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{COPY.cancel}</Button>
          <Button
            variant="primary"
            data-testid="new-chapter-submit"
            loading={busy}
            disabled={!/^[\w-]+$/.test(id.trim())}
            onClick={() => void submit()}
          >
            {C.fanqie.createChapter}
          </Button>
        </>
      }
    >
      <TextField
        label={C.fanqie.chapterId}
        value={id}
        onChange={setId}
        testId="new-chapter-id"
        hint={C.fanqie.chapterIdHint}
      />
      <TextField
        label={C.fanqie.chapterTitle}
        value={title}
        onChange={setTitle}
        testId="new-chapter-title"
        autoFocus
      />
    </Dialog>
  );
}

function Board({
  chapters,
  onOpen,
}: {
  chapters: readonly ChapterRowView[];
  onOpen: (id: string) => void;
}) {
  const words = chapters.reduce((sum, c) => sum + c.wordCount, 0);
  const finals = chapters.filter((c) => c.status === "final").length;
  return (
    <section className="zz-board" data-testid="board" aria-label={C.topbar.viewBoard}>
      <header className="zz-board__stats">
        <span data-testid="board-chapters">{C.fanqie.boardChapters(chapters.length)}</span>
        <span data-testid="board-final">{C.fanqie.boardFinal(finals)}</span>
        <span data-testid="board-words">{C.fanqie.boardWords(words)}</span>
      </header>
      {chapters.length ? (
        <table className="zz-table">
          <thead>
            <tr>
              <th>{C.fanqie.chapterTitle}</th>
              <th>{C.fanqie.words}</th>
              <th>{C.fanqie.status}</th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((c) => (
              <tr key={c.id} data-testid="board-row" data-chapter-id={c.id} data-status={c.status}>
                <td>
                  <button type="button" className="zz-link" onClick={() => onOpen(c.id)}>
                    {c.title || c.id}
                  </button>
                </td>
                <td>{c.wordCount}</td>
                <td>
                  <StatusChip
                    tone={c.status === "final" ? "ok" : c.status === "reviewed" ? "run" : "neutral"}
                    label={statusLabel("fanqie", c.status)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title={C.fanqie.emptyBoard} />
      )}
    </section>
  );
}

export function FanqieWorkspace({ target, readonly }: { target: Target; readonly: boolean }) {
  const fanqie = useFanqie(target.path);
  const { state, view, dispatch, refresh } = fanqie;
  const mainView = useDesktop((s) => s.view);
  const revisions = useDesktop((s) => s.revisions);
  const workTitle = useDesktop((s) => s.selected?.label ?? "");
  const [creating, setCreating] = useState(false);
  const pendingSelect = useRef("");

  // 主进程广播的写作区变化（流水线交付、采纳、助手发起的命令）→ 增量重读快照与正文。
  const firstRevision = useRef(true);
  useEffect(() => {
    if (firstRevision.current) {
      firstRevision.current = false;
      return;
    }
    dispatch({ type: "reloadBodies" });
    void refresh();
  }, [revisions.rows, revisions.chapter, dispatch, refresh]);

  useEffect(() => {
    const id = pendingSelect.current;
    if (id && view.chapters.some((c) => c.id === id)) {
      pendingSelect.current = "";
      dispatch({ type: "selectChapter", id });
    }
  }, [view.chapters, dispatch]);

  const currentChapterId = view.current?.id;
  const currentChapterTitle = view.current?.title;
  useEffect(() => {
    set({
      focus: {
        chapter: currentChapterId,
        title: currentChapterTitle,
        workTitle,
        source: "chapter",
      },
    });
  }, [currentChapterId, currentChapterTitle, workTitle]);

  useEffect(() => {
    set({ chapters: view.chapters.map((c) => ({ id: c.id, title: c.title })) });
  }, [view.chapters]);

  useEffect(
    () => () => {
      trackEditor(null);
      set({ chapters: [] });
    },
    [],
  );

  const selectChapter = (id: string) =>
    run(async () => {
      if (id !== state.chapterId && !(await canLeave())) return;
      dispatch({ type: "selectChapter", id });
      set({ view: "writing" });
    });

  const current = view.current;
  return (
    <div className="zz-workspace zz-workspace--fanqie">
      <nav className="zz-workspace__nav" aria-label={C.fanqie.chapters}>
        <header className="zz-workspace__nav-head">
          <h2>{C.fanqie.chapters}</h2>
          <Button
            size="sm"
            data-testid="new-chapter"
            disabled={readonly}
            onClick={() => setCreating(true)}
          >
            <Plus size={14} aria-hidden="true" />
            {C.fanqie.newChapter}
          </Button>
        </header>
        <ChapterList
          chapters={view.chapters}
          selectedId={state.chapterId}
          onSelect={selectChapter}
        />
      </nav>
      <section className="zz-workspace__center">
        {mainView === "board" ? (
          <Board chapters={view.chapters} onOpen={selectChapter} />
        ) : (
          <>
            {current ? (
              <div className="zz-chapter-bar" data-testid="chapter-bar">
                <Button
                  size="sm"
                  data-testid="chapter-start-pipeline"
                  disabled={readonly}
                  onClick={() => openPipeline(current.id)}
                >
                  <Workflow size={14} aria-hidden="true" />
                  {C.fanqie.startPipeline}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  data-testid="chapter-finalize"
                  disabled={readonly || current.status !== "reviewed" || Boolean(state.busyAction)}
                  title={current.status !== "reviewed" ? C.fanqie.finalizeHint : undefined}
                  onClick={() =>
                    dispatch({
                      type: "openDialog",
                      dialog: { kind: "finalize", chapterId: current.id },
                    })
                  }
                >
                  <Check size={14} aria-hidden="true" />
                  {COPY["fanqie.action.finalize"]}
                </Button>
              </div>
            ) : null}
            {state.error && !view.chapters.length ? (
              <Empty title={C.fanqie.loadFailed} description={state.error} />
            ) : (
              <Reader
                state={state}
                view={view}
                dispatch={dispatch}
                onSaveChapter={(body, base) => fanqie.saveChapter(body, base)}
                onEditState={trackEditor}
              />
            )}
          </>
        )}
      </section>
      <Dialogs
        state={state}
        dispatch={dispatch}
        onFinalize={(id) => fanqie.finalizeChapter(id).catch(notifyError)}
        onAcceptCandidate={(chapter, candidate, base) =>
          fanqie.acceptCandidate(chapter, candidate, base).catch(notifyError)
        }
      />
      {creating ? (
        <NewChapterDialog
          work={target.path}
          chapters={view.chapters}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            pendingSelect.current = id;
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
