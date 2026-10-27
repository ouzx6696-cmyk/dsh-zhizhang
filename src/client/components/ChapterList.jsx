/** Left column: chapters with their pending candidates, filter and keyboard walk. */
import React from "react";
import { formatCount, t } from "../copy.js";
import { Icon, SegmentedControl, cx } from "../ui.jsx";
import { Empty, StatusDot, clip, statusLabel } from "./common.jsx";

const { memo, useMemo, useState } = React;

function matches(chapter, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return String(chapter.title || "").toLowerCase().includes(q) || String(chapter.id || "").toLowerCase().includes(q);
}

function ChapterListImpl({ chapters, byChapter, impacts, chapterId, candidateId, readerView, onSelectChapter, onSelectCandidate }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const showTools = chapters.length > 6;
  const visible = useMemo(
    () =>
      chapters.filter((c) => {
        if (!matches(c, query)) return false;
        if (filter === "pending") return byChapter.has(c.id);
        if (filter === "attention") return byChapter.has(c.id) || impacts.has(c.id);
        return true;
      }),
    [chapters, byChapter, impacts, query, filter],
  );

  // Arrow keys walk the chapter rows; Enter/Space are native button activation.
  const onKeyDown = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const rows = Array.from(event.currentTarget.querySelectorAll("[data-zz-row]"));
    const at = rows.indexOf(document.activeElement);
    if (!rows.length) return;
    event.preventDefault();
    let next = at;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else next = Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next].focus();
  };

  if (!chapters.length) return <Empty hint={t("chaptersEmpty")} />;

  return (
    <div className="zz-chapter-nav">
      {showTools ? (
        <div className="zz-chapter-tools">
          <label className="zz-search">
            <Icon name="search" size={14} />
            <span className="zz-visually-hidden">{t("chapterFilter")}</span>
            <input type="search" value={query} placeholder={t("chapterFilterPlaceholder")} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <SegmentedControl
            id="zz-chapter-filter"
            label={t("chapterFilter")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("chapterFilterAll") },
              { value: "pending", label: t("chapterFilterPending") },
              { value: "attention", label: t("chapterFilterAttention") },
            ]}
          />
        </div>
      ) : null}
      {visible.length === 0 ? (
        <Empty hint={t("chapterNoMatch")} />
      ) : (
        <ul className="zz-chapter-list" onKeyDown={onKeyDown}>
          {visible.map((c) => {
            const cands = byChapter.get(c.id) || [];
            const selected = c.id === chapterId;
            return (
              <li key={c.id} className="zz-chapter-item">
                <button
                  type="button"
                  data-zz-row=""
                  className={cx("zz-chapter-row", selected && "zz-chapter-row-on")}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelectChapter(c.id)}
                >
                  <StatusDot status={c.status} />
                  <span className="zz-chapter-text">
                    <span className="zz-chapter-title" title={c.title}>
                      {c.title || c.id}
                    </span>
                    <span className="zz-chapter-meta">
                      {statusLabel(c.status)}
                      {c.wordCount ? " · " + t("words", { n: formatCount(c.wordCount) }) : ""}
                      {c.situationLens ? " · " + clip(c.situationLens, 28) : ""}
                    </span>
                  </span>
                  <span className="zz-chapter-flags">
                    {impacts.has(c.id) ? <span className="zz-flag" data-tone="danger">{t("impactBadge")}</span> : null}
                    {cands.length ? <span className="zz-flag" data-tone="warning">{cands.length}</span> : null}
                  </span>
                </button>
                {cands.length ? (
                  <ul className="zz-candidate-sublist">
                    {cands.map((pc) => {
                      const on = selected && readerView !== "official" && (candidateId ? candidateId === pc.id : cands[0].id === pc.id);
                      return (
                        <li key={pc.id}>
                          <button
                            type="button"
                            data-zz-row=""
                            className={cx("zz-candidate-row", on && "zz-candidate-row-on")}
                            aria-current={on ? "true" : undefined}
                            onClick={() => onSelectCandidate(c.id, pc.id)}
                          >
                            <span className="zz-candidate-label">{pc.draftLabel ? "「" + pc.draftLabel + "」" : pc.id}</span>
                            <span className="zz-candidate-meta">
                              {t("words", { n: formatCount(pc.wordCount || 0) })}
                              {pc.source === "unify" ? " · " + t("unify") : pc.editOf ? " · " + t("candidateEdit") : ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const ChapterList = memo(ChapterListImpl);
