import React, { useEffect } from "react";
import { WORKBENCH_COPY as W } from "@zhizhang/ui/copy";
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
  /** 章节条右侧的写作台动作（发起流水线、定稿）；编辑态不显示。 */
  actions?: React.ReactNode;
}

/**
 * 章节阅读 / 编辑：同一条章节条、同一列稿纸、同一个状态栏。
 * 编辑态只是把阅读稿纸换成同版式的源码框，文字列的位置与宽度不变。
 */
export function Reader({
  state,
  view,
  dispatch,
  onSaveChapter,
  onEditState,
  actions,
}: ReaderProps) {
  const readyText = state.chapter.status === "ready" && !state.edit ? state.chapter.body : null;
  const reading = useReadingPosition<HTMLDivElement>(readyText);
  const find = useReaderFind(reading.body, !state.edit && state.chapter.status === "ready");

  useEffect(() => {
    find.setText(state.chapter.body);
  }, [state.chapter.body, find]);

  const current = view.current;
  if (!current) {
    return <Empty title={W.reader.pick} hint={W.reader.pickHint} icon="book" />;
  }
  const ordinal = view.chapters.findIndex((c) => c.id === current.id) + 1;
  const lead = (
    <span className="wb-bar-ordinal" data-testid="chapter-ordinal">
      {W.reader.chapterOrdinal(ordinal || 1)}
    </span>
  );
  const title = state.chapter.title || current.title;

  if (state.edit && state.chapter.status === "ready") {
    return (
      <SourceEditor
        initial={state.chapter.body}
        title={title}
        lead={lead}
        draftKey={chapterDraftKey({
          work: state.work,
          chapter: current.id,
          slot: "official",
        })}
        baseRevision={state.chapter.revision || current.revision}
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

  return (
    <div className="wb-reader" data-testid="chapter-reader">
      <header className="wb-bar" data-testid="chapter-bar">
        <div className="wb-bar-lead">
          {lead}
          <StatusTag status={current.status} mode="fanqie" />
        </div>
        <div className="wb-bar-actions">
          <Button
            variant="ghost"
            size="sm"
            title={W.reader.findHint}
            aria-keyshortcuts="Control+F"
            disabled={state.chapter.status !== "ready"}
            onClick={() => find.find.open("find")}
          >
            <Icon name="search" size={14} />
            {W.reader.find}
          </Button>
          <Button
            size="sm"
            data-testid="chapter-edit"
            aria-label={W.reader.editLabel}
            disabled={state.chapter.status !== "ready"}
            onClick={() => {
              reading.enter();
              dispatch({ type: "edit", value: true });
            }}
          >
            <Icon name="pen" size={14} />
            {W.reader.edit}
          </Button>
          {actions}
        </div>
      </header>
      {find.bar}
      {state.chapter.status === "error" ? (
        <Callout tone="danger">{state.chapter.error || W.reader.loadFailed}</Callout>
      ) : null}
      <div className="wb-reader-body" ref={reading.body} data-testid="chapter-body">
        {state.chapter.status === "loading" ? (
          <div className="wb-manuscript">
            <Skeleton lines={10} />
          </div>
        ) : (
          <Manuscript
            text={state.chapter.body}
            title={title}
            emptyText={W.reader.emptyBody}
            query={find.find.mode ? find.find.query : ""}
            matchCase={find.find.matchCase}
            activeMatch={find.active}
          />
        )}
      </div>
      <footer className="wb-statusbar">
        <span className="wb-statusbar-item">{W.editor.words(current.wordCount)}</span>
        <span className="wb-statusbar-spacer" />
        <span className="wb-statusbar-item">{W.reader.findHint}</span>
      </footer>
    </div>
  );
}
