import { humanVersion } from "../../format";
import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import React, { useEffect } from "react";
import { useFanqie } from "../../../../../../packages/workbench/src/client/fanqie/useFanqie.js";
import { ChapterList } from "../../../../../../packages/workbench/src/client/fanqie/ChapterList.jsx";
import { Reader } from "../../../../../../packages/workbench/src/client/fanqie/Reader.jsx";
import { Inspector } from "../../../../../../packages/workbench/src/client/fanqie/Inspector.jsx";
import { Pipeline } from "../../../../../../packages/workbench/src/client/fanqie/Pipeline.jsx";
import { Dialogs } from "../../../../../../packages/workbench/src/client/fanqie/Dialogs.jsx";
import { Diagnostics } from "../../../../../../packages/workbench/src/client/fanqie/Diagnostics.jsx";
import { Notices } from "../../../../../../packages/workbench/src/client/shared/common.jsx";
import { Check, FileCheck } from "lucide-react";
import { StatusBadge } from "../../../../../../packages/ui/src/status-badge";
import type { WorkspaceProps } from "../../../renderer-contracts";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { Articles } from "./Articles";
function Novel(props: WorkspaceProps) {
  const annotationId = React.useId();
  const { state, view, actions, sourceGuard } = useFanqie({
      onTarget: props.onTarget,
      onSourceEditState: props.onSourceEditState,
    }),
    { dispatch } = actions;
  useEffect(() => {
    dispatch({
      type: "view",
      view: props.view === "writing" ? "chapters" : "overview",
    });
    if (props.view !== "writing")
      dispatch({ type: "tab", tab: props.view === "library" ? "library" : "overview" });
  }, [props.view]);
  useEffect(() => {
    const chapter = view.current;
    props.onContext({
      chapter,
      hasCandidate: !!view.activeCand,
      candidate: view.activeCand,
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
  }, [
    view.current,
    view.activeCand,
    state.chapter,
    state.edit,
    sourceGuard.dirty,
    view.snap?.title,
    actions.refresh,
  ]);
  const current = view.current,
    meta = state.chapter.meta,
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
  const assigned = new Set(),
    groups = (view.snap?.volumes || []).map((volume: any) => ({
      ...volume,
      rows: view.chapters.filter((chapter: any) => {
        if (!volume.chapters.includes(chapter.id) || assigned.has(chapter.id)) return false;
        assigned.add(chapter.id);
        return true;
      }),
    }));
  const ungrouped = view.chapters.filter((chapter: any) => !assigned.has(chapter.id));
  if (ungrouped.length)
    groups.push({
      id: "ungrouped",
      title: groups.length ? viewCopy.workspaceText5 : "",
      rows: ungrouped,
    });
  const navigation = (
    <>
      <h2>{viewCopy.writingChapters}</h2>
      {groups.map((group: any) => (
        <section className="nav-volume" key={group.id}>
          {group.title && <h3>{group.title}</h3>}
          <ChapterList
            chapters={group.rows}
            byChapter={view.byChapter}
            impacts={view.impacts}
            chapterId={state.chapterId}
            onSelectChapter={(id: string) => dispatch({ type: "selectChapter", id })}
            onSelectCandidate={(chapterId: string, id: string) =>
              dispatch({ type: "selectCandidate", chapterId, id })
            }
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
          dispatch: (event: any) => {
            actions.dispatch(event);
            if (event.type === "view" && event.view === "chapters") props.onView?.("writing");
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
      <Notices
        notices={state.notices}
        onDismiss={(id: string) => dispatch({ type: "dismissNotice", id })}
      />
    </>
  );
}
export function Workspace(props: WorkspaceProps) {
  return props.target.mode === "fanqie" ? <Novel {...props} /> : <Articles {...props} />;
}
