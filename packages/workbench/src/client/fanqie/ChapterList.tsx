import React from "react";
import type { ChapterRowView } from "@zhizhang/fanqie/view";
import { WORKBENCH_COPY as W } from "@zhizhang/ui/copy";
import { Empty, StatusDot, cx } from "../shared/components.js";

export interface ChapterListProps {
  chapters: readonly ChapterRowView[];
  selectedId: string;
  onSelect: (id: string) => void;
}

const ChapterRow = React.memo(function ChapterRow({
  chapter,
  index,
  active,
  onSelect,
}: {
  chapter: ChapterRowView;
  index: number;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        data-testid="chapter-item"
        data-chapter-id={chapter.id}
        data-status={chapter.status}
        className={cx("wb-list-item", active && "wb-list-item-on")}
        onClick={() => onSelect(chapter.id)}
      >
        <StatusDot status={chapter.status} mode="fanqie" />
        <span className="wb-list-index" aria-hidden="true">
          {W.list.ordinal(index + 1)}
        </span>
        <span className="wb-list-title">{chapter.title || chapter.id}</span>
        <span className="wb-list-meta">{W.list.words(chapter.wordCount)}</span>
      </button>
    </li>
  );
});

export function ChapterList({ chapters, selectedId, onSelect }: ChapterListProps) {
  if (!chapters.length) {
    return <Empty title={W.list.empty} hint={W.list.emptyHint} icon="book" />;
  }
  return (
    <ul className="wb-list" role="listbox" aria-label={W.list.chapters} data-testid="chapter-list">
      {chapters.map((ch, index) => (
        <ChapterRow
          key={ch.id}
          chapter={ch}
          index={index}
          active={ch.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
