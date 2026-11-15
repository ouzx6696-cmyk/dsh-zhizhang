import React from "react";
import type { ChapterRowView } from "@zhizhang/fanqie/view";
import { Empty, StatusDot, cx } from "../shared/components.js";

export interface ChapterListProps {
  chapters: readonly ChapterRowView[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function ChapterList({ chapters, selectedId, onSelect }: ChapterListProps) {
  if (!chapters.length) {
    return <Empty title="暂无章节" hint="创建或导入章节后将在此显示" icon="book" />;
  }
  return (
    <ul className="wb-chapter-list" role="listbox" aria-label="章节列表">
      {chapters.map((ch) => {
        const active = ch.id === selectedId;
        return (
          <li key={ch.id}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              className={cx("wb-chapter-item", active && "wb-chapter-item-on")}
              onClick={() => onSelect(ch.id)}
            >
              <StatusDot status={ch.status} mode="fanqie" />
              <span className="wb-chapter-title">{ch.title || ch.id}</span>
              <span className="wb-chapter-meta">{ch.wordCount} 字</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
