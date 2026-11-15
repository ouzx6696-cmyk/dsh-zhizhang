import React, { useEffect } from "react";
import { Button } from "@zhizhang/ui/primitives";
import { chapterDraftKey } from "../../editor/drafts.js";
import { Callout, Empty, Icon, Skeleton, StatusTag } from "../shared/components.js";
import { Manuscript } from "../shared/Manuscript.js";
import { useReadingPosition } from "../shared/reading-position.js";
import { SourceEditor } from "../shared/SourceEditor.js";
import { useReaderFind } from "../shared/useReaderFind.js";
import type { EditorGuardSnapshot } from "../shared/useSourceGuard.js";
import type { FanqieAction, FanqieDerived, FanqieState } from "./state.js";

export interface ReaderProps {
  state: FanqieState;
  view: FanqieDerived;
  dispatch: React.Dispatch<FanqieAction>;
  onSaveChapter: (body: string, base: string) => Promise<void>;
  onEditState?: (snapshot: EditorGuardSnapshot | null) => void;
}

export function Reader({ state, view, dispatch, onSaveChapter, onEditState }: ReaderProps) {
  const readyText = state.chapter.status === "ready" && !state.edit ? state.chapter.body : null;
  const reading = useReadingPosition<HTMLDivElement>(readyText);
  const find = useReaderFind(reading.body, !state.edit && state.chapter.status === "ready");

  useEffect(() => {
    find.setText(state.chapter.body);
  }, [state.chapter.body, find]);

  if (!view.current) {
    return <Empty title="请选择章节" hint="从左侧章节列表中选择一章进行阅读或编辑" icon="book" />;
  }

  if (state.edit && state.chapter.status === "ready") {
    return (
      <SourceEditor
        initial={state.chapter.body}
        title={state.chapter.title || view.current.title}
        draftKey={chapterDraftKey({
          work: state.work,
          chapter: view.current.id,
          slot: "official",
        })}
        baseRevision={state.chapter.revision || view.current.revision}
        position={reading.position}
        onSave={onSaveChapter}
        onCancel={() => {
          reading.leave();
          dispatch({ type: "edit", value: false });
        }}
        onStateChange={onEditState}
      />
    );
  }

  const readerStyle = { "--zz-font-step": String(state.fontStep) } as React.CSSProperties;

  return (
    <div className="wb-reader" style={readerStyle} data-testid="chapter-reader">
      <header className="wb-reader-head">
        <div className="wb-reader-title-group">
          <h2>{state.chapter.title || view.current.title}</h2>
          <StatusTag status={view.current.status} mode="fanqie" />
        </div>
        <div className="wb-reader-actions">
          <Button
            variant="secondary"
            data-testid="chapter-edit"
            disabled={state.chapter.status !== "ready"}
            onClick={() => {
              reading.enter();
              dispatch({ type: "edit", value: true });
            }}
          >
            <Icon name="pen" size={14} />
            编辑正文
          </Button>
        </div>
      </header>
      {find.bar}
      {state.chapter.status === "error" ? (
        <Callout tone="danger" role="alert">
          {state.chapter.error || "章节加载失败"}
        </Callout>
      ) : null}
      <div className="wb-reader-body" ref={reading.body} data-testid="chapter-body">
        {state.chapter.status === "loading" ? (
          <Skeleton lines={8} />
        ) : (
          <Manuscript
            text={state.chapter.body}
            query={find.find.mode ? find.find.query : ""}
            matchCase={find.find.matchCase}
            activeMatch={find.active}
          />
        )}
      </div>
    </div>
  );
}
