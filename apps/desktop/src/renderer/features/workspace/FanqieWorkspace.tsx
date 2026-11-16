import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Dialog, Empty, IconButton, StatusChip } from "@zhizhang/ui/primitives";
import { statusChipTone, statusLabel } from "@zhizhang/ui/status";
import { ChapterList, Dialogs, Reader, useFanqie } from "@zhizhang/workbench/client";
import type { ChapterRowView } from "@zhizhang/fanqie/view";
import type { Target } from "../../../shared/views";
import { canLeave, trackEditor } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
import { notifyError, run } from "../../format";
import { ChapterActions } from "./ChapterActions";
import { TextField } from "./TextField";

const set = desktopStore.set;

const CompareView = lazy(() =>
  import("../workflow/DraftCompare").then((m) => ({ default: m.CompareView })),
);

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
        <div className="zz-board__stat" data-testid="board-chapters">
          <span>{C.fanqie.statChapters}</span>
          <strong>{chapters.length}</strong>
        </div>
        <div className="zz-board__stat" data-testid="board-final">
          <span>{C.fanqie.statFinal}</span>
          <strong>{finals}</strong>
        </div>
        <div className="zz-board__stat" data-testid="board-words">
          <span>{C.fanqie.statWords}</span>
          <strong>{words.toLocaleString("zh-CN")}</strong>
        </div>
      </header>
      {chapters.length ? (
        <div className="zz-board__sheet">
          <table className="zz-table">
            <thead>
              <tr>
                <th className="zz-table__num">{C.fanqie.index}</th>
                <th>{C.fanqie.chapterTitle}</th>
                <th className="zz-table__num">{C.fanqie.words}</th>
                <th>{C.fanqie.status}</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((c, index) => (
                <tr
                  key={c.id}
                  data-testid="board-row"
                  data-chapter-id={c.id}
                  data-status={c.status}
                >
                  <td className="zz-table__num zz-table__muted">
                    {String(index + 1).padStart(2, "0")}
                  </td>
                  <td>
                    <button type="button" className="zz-link" onClick={() => onOpen(c.id)}>
                      {c.title || c.id}
                    </button>
                  </td>
                  <td className="zz-table__num">{c.wordCount.toLocaleString("zh-CN")}</td>
                  <td>
                    <StatusChip
                      tone={statusChipTone("fanqie", c.status)}
                      label={statusLabel("fanqie", c.status)}
                      dot
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

  // 主进程广播的写作区变化（流水线交付、采纳、助手发起的命令）→ 只增量重读快照。
  // 正文是否重读由正文键决定：当前章 revision 变了且不在编辑态时才重读，编辑中不会被踢出（D3）。
  const firstRevision = useRef(true);
  useEffect(() => {
    if (firstRevision.current) {
      firstRevision.current = false;
      return;
    }
    void refresh();
  }, [revisions.rows, revisions.chapter, refresh]);

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
  const compare = useDesktop((s) => s.compare);
  const compareKind = useDesktop((s) => s.runs.find((r) => r.id === s.compare?.runId)?.kind);
  const comparing = compare && compare.target.path === target.path ? compare : null;
  const totalWords = view.chapters.reduce((sum, c) => sum + c.wordCount, 0);
  return (
    <div className="zz-workspace zz-workspace--fanqie" data-compare={comparing ? "on" : "off"}>
      <nav className="zz-workspace__nav" aria-label={C.fanqie.chapters}>
        <header className="zz-nav-head">
          <h2>
            {C.fanqie.chapters}
            <span className="zz-nav-head__count">{view.chapters.length}</span>
          </h2>
          <IconButton
            size="sm"
            label={C.fanqie.newChapter}
            data-testid="new-chapter"
            disabled={readonly}
            icon={<Plus size={16} />}
            onClick={() => setCreating(true)}
          />
        </header>
        <div className="zz-nav-body">
          <ChapterList
            chapters={view.chapters}
            selectedId={state.chapterId}
            onSelect={selectChapter}
          />
        </div>
        {view.chapters.length ? (
          <footer className="zz-nav-foot">
            {C.fanqie.navTotal(view.chapters.length, totalWords)}
          </footer>
        ) : null}
      </nav>
      <section className="zz-workspace__center">
        {comparing ? (
          <Suspense fallback={null}>
            <CompareView request={comparing} kind={compareKind ?? "fanqie.chapter"} />
          </Suspense>
        ) : mainView === "board" ? (
          <div className="zz-center-scroll">
            <Board chapters={view.chapters} onOpen={selectChapter} />
          </div>
        ) : state.error && !view.chapters.length ? (
          <Empty title={C.fanqie.loadFailed} description={state.error} />
        ) : (
          <Reader
            state={state}
            view={view}
            dispatch={dispatch}
            onSaveChapter={(body, base, title) => fanqie.saveChapter(body, base, title)}
            onEditState={trackEditor}
            actions={
              current ? (
                <ChapterActions
                  chapterId={current.id}
                  reviewed={current.status === "reviewed"}
                  readonly={readonly}
                  busy={Boolean(state.busyAction)}
                  onFinalize={() =>
                    dispatch({
                      type: "openDialog",
                      dialog: { kind: "finalize", chapterId: current.id },
                    })
                  }
                />
              ) : null
            }
          />
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
