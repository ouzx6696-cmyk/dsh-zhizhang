import { COPY as viewCopy, t as viewText } from "@writer/ui/copy";
import { statusLabel as canonicalStatusLabel } from "@writer/ui/status";
const statusLabel = (status) => canonicalStatusLabel("fanqie", status);
/** Left column: chapters with their pending candidates, filter and keyboard walk. */
import React from "react";
import { formatCount, t } from "@writer/ui/copy";
import { Icon, SegmentedControl, cx } from "../shared/ui.js";
import { Empty, StatusDot, clip } from "../shared/common.jsx";

const { memo, useMemo, useState } = React;

function matches(chapter, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    String(chapter.title || "")
      .toLowerCase()
      .includes(q) ||
    String(chapter.id || "")
      .toLowerCase()
      .includes(q)
  );
}

function ChapterListImpl({
  chapters,
  byChapter,
  impacts,
  chapterId,
  onSelectChapter,
  onSelectCandidate,
}) {
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
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    )
      return;
    const rows = Array.from(event.currentTarget.querySelectorAll("[data-wb-row]"));
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
    <div className="wb-chapter-nav">
      {showTools ? (
        <div className="wb-chapter-tools">
          <label className="wb-search">
            <Icon name="search" size={14} />
            <span className="wb-visually-hidden">{t("chapterFilter")}</span>
            <input
              type="search"
              value={query}
              placeholder={t("chapterFilterPlaceholder")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <SegmentedControl
            id="wb-chapter-filter"
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
        <ul className="wb-chapter-list" onKeyDown={onKeyDown}>
          {visible.map((c) => {
            const cands = byChapter.get(c.id) || [];
            const selected = c.id === chapterId;
            return (
              <li key={c.id} className="wb-chapter-item">
                <div className="wb-chapter-line">
                  <button
                    type="button"
                    data-wb-row=""
                    className={cx("wb-chapter-row", selected && "wb-chapter-row-on")}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelectChapter(c.id)}
                  >
                    <StatusDot status={c.status} />
                    <span className="wb-chapter-text">
                      <span className="wb-chapter-title" title={c.title}>
                        {c.title || viewCopy.chapterListText1}
                      </span>
                      <span className="wb-chapter-meta">
                        {statusLabel(c.status)}
                        {c.wordCount ? " · " + t("words", { n: formatCount(c.wordCount) }) : ""}
                        {c.situationLens ? " · " + clip(c.situationLens, 28) : ""}
                      </span>
                    </span>
                    <span className="wb-chapter-flags">
                      {impacts.has(c.id) ? (
                        <span className="wb-flag" data-tone="danger">
                          {t("impactBadge")}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {cands.length ? (
                    <button
                      type="button"
                      className="wb-candidate-badge"
                      aria-label={viewText("chapterListText2", { value0: cands.length })}
                      title={viewText("chapterListText2", { value0: cands.length })}
                      onClick={() => onSelectCandidate(c.id, cands[cands.length - 1].id)}
                    >
                      {cands.length}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const ChapterList = memo(ChapterListImpl);
