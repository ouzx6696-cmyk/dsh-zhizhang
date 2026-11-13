import { humanVersion } from "../../format";
import { COPY as viewCopy } from "@writer/ui/copy";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useFanqie } from "../../../../../../packages/workbench/src/client/fanqie/useFanqie.js";
import { ChapterList } from "../../../../../../packages/workbench/src/client/fanqie/ChapterList.jsx";
import { Reader } from "../../../../../../packages/workbench/src/client/fanqie/Reader.jsx";
import { Inspector } from "../../../../../../packages/workbench/src/client/fanqie/Inspector.jsx";
import { Pipeline } from "../../../../../../packages/workbench/src/client/fanqie/Pipeline.jsx";
import { Dialogs } from "../../../../../../packages/workbench/src/client/fanqie/Dialogs.jsx";
import { Diagnostics } from "../../../../../../packages/workbench/src/client/fanqie/Diagnostics.jsx";
import { Check, FileCheck } from "lucide-react";
import { StatusBadge } from "@writer/ui/status-badge";
import type { WorkspaceProps } from "../../../renderer-contracts";
import type { Focus, Target } from "../../../context";
import { useWorkspaceNavigator } from "../../state/navigation";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { Articles } from "./Articles";
/** 快照章节行（panel-query chapterRows 产出；分组只读 id）。 */
interface SnapshotChapterRow {
  id: string;
}
/** 快照卷分组（meta.planning.volumes 映射；chapters 为卷内章节 id）。 */
interface SnapshotVolume {
  id: string;
  title?: string;
  chapters: string[];
}
/** 左侧导航的卷分组行。 */
interface VolumeGroup {
  id: string;
  title?: string;
  chapters?: string[];
  rows: SnapshotChapterRow[];
}

/** 按卷分组章节；同一章只归第一个列出它的卷，未归卷的章节收进末尾分组。 */
function volumeGroups(volumes: SnapshotVolume[], chapters: SnapshotChapterRow[]) {
  const assigned = new Set<string>();
  const groups: VolumeGroup[] = volumes.map((volume) => {
    const members = new Set(volume.chapters);
    const rows = chapters.filter((chapter) => members.has(chapter.id) && !assigned.has(chapter.id));
    for (const row of rows) assigned.add(row.id);
    return { ...volume, rows };
  });
  const ungrouped = chapters.filter((chapter) => !assigned.has(chapter.id));
  if (ungrouped.length)
    groups.push({
      id: "ungrouped",
      title: groups.length ? viewCopy.workspaceText5 : "",
      rows: ungrouped,
    });
  return groups;
}

/** 待采纳候选（快照 candidates 中 pending 的项）；跳转只读 id 与所属章节。 */
interface PendingCandidate {
  id: string;
  chapterId: string;
}

const Novel = React.memo(function Novel(props: WorkspaceProps) {
  const annotationId = React.useId();
  const { onContext } = props;
  const { state, view, actions } = useFanqie({
      onTarget: props.onTarget,
      onSourceEditState: props.onSourceEditState,
    }),
    { dispatch, refresh } = actions;
  const latestView = useRef(view);
  useEffect(() => {
    latestView.current = view;
  });
  // 同一部作品内的跳转（结果卡“查看”、对照采纳）就地切到章节或候选稿，不重挂载写作区。
  const navigate = useCallback(
    async (_target: Target, focus: Focus) => {
      const pending: PendingCandidate[] = latestView.current.pending;
      const chapters: SnapshotChapterRow[] = latestView.current.chapters;
      const chapterId =
        focus.chapter || pending.find((candidate) => candidate.id === focus.candidate)?.chapterId;
      if (!chapterId) return;
      const moved = await (focus.candidate
        ? dispatch({ type: "selectCandidate", chapterId, id: focus.candidate })
        : dispatch({ type: "selectChapter", id: chapterId }));
      const known =
        chapters.some((chapter) => chapter.id === chapterId) &&
        (!focus.candidate || pending.some((candidate) => candidate.id === focus.candidate));
      // 刚写出的章节或候选还不在快照里：选中后重读一次快照，读到后选中项保持不变。
      if (moved && !known) void refresh();
    },
    [dispatch, refresh],
  );
  useWorkspaceNavigator(props.target, navigate);
  const selectChapter = useCallback(
    (id: string) => dispatch({ type: "selectChapter", id }),
    [dispatch],
  );
  const selectCandidate = useCallback(
    (chapterId: string, id: string) => dispatch({ type: "selectCandidate", chapterId, id }),
    [dispatch],
  );
  useEffect(() => {
    dispatch({
      type: "view",
      view: props.view === "writing" ? "chapters" : "overview",
    });
    if (props.view !== "writing")
      dispatch({ type: "tab", tab: props.view === "library" ? "library" : "overview" });
  }, [props.view, dispatch]);
  const { current, activeCand } = view;
  useEffect(() => {
    const chapter = current;
    onContext({
      chapter,
      hasCandidate: !!activeCand,
      candidate: activeCand,
      review: state.chapter.writer?.editorReview,
      kind: "novel",
      outlineReady: [
        "pov",
        "targetWords",
        "locks",
        "knowledge",
        "synopsis",
        "conflict",
        "beats",
        "ending",
      ].every((key) => {
        const value = state.chapter.outline?.[key];
        return typeof value === "number" ? value > 0 : typeof value === "string" && !!value.trim();
      }),
      actions: {
        saveParagraph: actions.diagnostics.save,
        refresh: actions.refresh,
      },
    });
  }, [current, activeCand, state.chapter, onContext, actions.diagnostics.save, actions.refresh]);
  const meta = state.chapter.meta,
    review = meta?.review;
  const reviewed = review?.revision === meta?.revision && review?.result === "pass";
  const canRead = state.chapter.status === "ready" && !state.chapter.truncated;
  const finalizeBlocked =
    !canRead ||
    !reviewed ||
    !!state.chapter.writer?.finalizeBlocked ||
    meta?.status === "final" ||
    props.readOnly;
  const stage =
    meta?.status === "final"
      ? 3
      : reviewed
        ? 2
        : state.chapter.status === "ready" || (meta?.wordCount || 0) > 0
          ? 1
          : 0;
  const revision = meta?.revision ?? current?.revision,
    updatedAt = meta?.updatedAt || current?.updatedAt,
    versionLabel = revision !== undefined || updatedAt ? humanVersion(revision, updatedAt) : "";
  const decisions = (
    <div className="paper-decisions">
      <strong className="paper-chapter-title">{current?.title || viewCopy.workspaceText3}</strong>
      <StatusBadge mode="fanqie" status={meta?.status || current?.status} />
      <ol className="paper-steps" aria-label={viewCopy.lifecycle}>
        {[
          viewCopy.tabInspiration,
          viewCopy.tabWriting,
          viewCopy.designPreviewText8,
          viewCopy.finalizeTitle,
        ].map((step, index) => (
          <li
            key={step}
            data-state={index < stage ? "done" : index === stage ? "current" : "todo"}
            aria-current={index === stage ? "step" : undefined}
          >
            {step}
          </li>
        ))}
      </ol>
      {versionLabel ? <span className="paper-version">{versionLabel}</span> : null}
      {current && (
        <>
          <button disabled={!canRead || props.readOnly} onClick={props.onReview}>
            {viewCopy.designPreviewText4}
          </button>
          <button
            disabled={!canRead || props.readOnly}
            onClick={() => dispatch({ type: "openDialog", dialog: { kind: "review" } })}
          >
            <FileCheck size={14} />
            {viewCopy.reviewTitle}
          </button>
          {view.activeCand ? (
            <button
              disabled={props.readOnly}
              onClick={() =>
                dispatch({
                  type: "openDialog",
                  dialog: { kind: "accept", cand: view.activeCand },
                })
              }
            >
              {viewCopy.acceptTitle}
            </button>
          ) : null}
          <button
            className="primary"
            disabled={finalizeBlocked}
            title={
              state.chapter.writer?.finalizeBlocked || (!reviewed ? viewCopy.workspaceText4 : "")
            }
            onClick={() => dispatch({ type: "openDialog", dialog: { kind: "finalize" } })}
          >
            <Check size={14} />
            {viewCopy.finalizeTitle}
          </button>
        </>
      )}
    </div>
  );
  const volumes: SnapshotVolume[] | undefined = view.snap?.volumes;
  const chapters: SnapshotChapterRow[] = view.chapters;
  // 卷 × 章的分组只在快照变化时重算，避免每次渲染都全量扫描。
  const groups = useMemo(() => volumeGroups(volumes || [], chapters), [volumes, chapters]);
  const navigation = (
    <>
      <h2>{viewCopy.writingChapters}</h2>
      {groups.map((group) => (
        <section className="nav-volume" key={group.id}>
          {group.title && <h3>{group.title}</h3>}
          <ChapterList
            chapters={group.rows}
            byChapter={view.byChapter}
            impacts={view.impacts}
            chapterId={state.chapterId}
            onSelectChapter={selectChapter}
            onSelectCandidate={selectCandidate}
          />
        </section>
      ))}
      <button disabled={!props.target.work || props.readOnly} onClick={props.onNewChapter}>
        {viewCopy.workspaceText6}
      </button>
    </>
  );

  const center =
    props.view !== "writing" ? (
      <Pipeline
        state={state}
        view={view}
        actions={{
          ...actions,
          dispatch: async (event: { type: string; view?: string }) => {
            const ok = await actions.dispatch(event);
            if (ok && event.type === "view" && event.view === "chapters") props.onView?.("writing");
            return ok;
          },
        }}
      />
    ) : (
      <>
        {decisions}
        {!view.snap ? (
          <div className="studio-empty">
            <h1>{viewCopy.workspaceText7}</h1>
            <p>{state.error || viewCopy.workspaceText8}</p>
          </div>
        ) : (
          <Reader
            state={state}
            view={view}
            actions={actions}
            annotationId={annotationId}
            readOnly={props.readOnly}
          />
        )}
      </>
    );
  return (
    <>
      <WorkspaceLayout
        tab={props.tab}
        setTab={props.setTab}
        drawer={props.drawer}
        setDrawer={props.setDrawer}
        onMethodEditState={props.onMethodEditState}
        mode="fanqie"
        navigation={navigation}
        center={center}
        inspector={
          <>
            <Diagnostics state={state} view={view} actions={actions} annotationId={annotationId} />
            <Inspector state={state} view={view} actions={actions} hideAgent compact />
          </>
        }
        agent={props.agent}
      />
      <Dialogs state={state} actions={actions} />
    </>
  );
});

/** 父组件的回调都已稳定；属性不变时整块写作区跳过重渲染。 */
export const Workspace = React.memo(function Workspace(props: WorkspaceProps) {
  return props.target.mode === "fanqie" ? <Novel {...props} /> : <Articles {...props} />;
});
