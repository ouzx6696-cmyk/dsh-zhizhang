import { COPY as viewCopy, formatCount, t, EDITOR_COPY } from "@writer/ui/copy";
/** 写作台 · 今日头条模式：左列文章、中间当前稿 / 交稿单、右侧状态、质检、采用与写作 Agent 按钮。 */
import React from "react";
import { Button, Icon, SegmentedControl, StateDot, Tag, cx } from "../shared/ui.js";
import { Callout, Empty, Skeleton } from "../shared/common.jsx";
import { Manuscript } from "../shared/Manuscript.jsx";
import { SourceEditor } from "../shared/SourceEditor.jsx";
import { articleDraftKey } from "../shared/drafts.js";
import { useReadingPosition } from "../shared/reading-position.js";
import { useReaderFind } from "../shared/useReaderFind.jsx";
import { statusInfo, statusLabel, statusTone } from "@writer/ui/status";

import { draftRoleLabel } from "./ToutiaoSide.jsx";

export { ToutiaoSide } from "./ToutiaoSide.jsx";

const { useState } = React;

function matches(a, q) {
  if (!q) return true;
  const k = q.toLowerCase();
  return String(a.title).toLowerCase().includes(k) || String(a.id).toLowerCase().includes(k);
}

export function ArticleList({ articles, sel, onSelect }) {
  const [query, setQuery] = useState("");
  const visible = articles.filter((a) => matches(a, query));
  const weekOf = (article) => {
    const date = new Date(article.updatedAt || article.id.slice(0, 10));
    if (Number.isNaN(date.getTime())) return t("olderArticles");
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return (
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-") +
      " " +
      t("currentWeek")
    );
  };
  const groups = [...new Set(visible.map(weekOf))]
    .sort((a, b) =>
      a === t("olderArticles") ? 1 : b === t("olderArticles") ? -1 : b.localeCompare(a),
    )
    .map((status) => ({ status, rows: visible.filter((article) => weekOf(article) === status) }));
  return (
    <div className="wb-chapter-nav">
      {articles.length > 6 ? (
        <div className="wb-chapter-tools">
          <label className="wb-search">
            <Icon name="search" size={14} />
            <span className="wb-visually-hidden">{t("ttFilter")}</span>
            <input
              type="search"
              value={query}
              placeholder={t("ttFilterPlaceholder")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      ) : null}
      {!groups.length ? <Empty hint={t("ttFilterEmpty")} /> : null}
      {groups.map((g) => (
        <section key={g.status} className="wb-tt-group" aria-label={g.status}>
          <h3 className="wb-tt-group-head">
            {g.status} <span className="wb-count">{g.rows.length}</span>
          </h3>
          <ul className="wb-chapter-list">
            {g.rows.map((a) => {
              const on = a.root === sel.root && a.id === sel.id;
              return (
                <li key={a.root + "|" + a.id} className="wb-chapter-item">
                  <button
                    type="button"
                    data-wb-row=""
                    className={cx("wb-chapter-row", on && "wb-chapter-row-on")}
                    aria-current={on ? "true" : undefined}
                    onClick={() => onSelect(a.root, a.id)}
                  >
                    <StateDot state={statusInfo("toutiao", a.status).dot} size={8} />
                    <span className="wb-chapter-text">
                      <span className="wb-chapter-title" title={a.title}>
                        {a.title}
                      </span>
                      <span className="wb-chapter-meta">
                        {a.genre}
                        {a.rev ? " · " + t("ttRev", { n: a.rev }) : ""}
                      </span>
                    </span>
                    {a.qa ? (
                      <span
                        className="wb-flag wb-tt-score"
                        data-pass={a.qa.pass ? "true" : "false"}
                        title={t(a.qa.pass ? "ttQaShortPass" : "ttQaShortFail", {
                          score: a.qa.score,
                        })}
                      >
                        {a.qa.score}
                      </span>
                    ) : (
                      <span />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Body({ detail, onSave, readOnly = false, onEditState }) {
  const [view, setView] = useState("draft");
  const [editing, setEditing] = useState(null);
  const text = detail.status === "ready" ? detail.article?.draft?.text : undefined;
  const reading = useReadingPosition(!editing && view === "draft" && text ? text : null);
  const finder = useReaderFind(reading.body, !editing);
  if (!editing && detail.status === "loading")
    return (
      <div className="wb-pane-loading" role="status">
        <Skeleton lines={8} />
      </div>
    );
  if (!editing && detail.status === "error")
    return (
      <Callout tone="danger" role="alert">
        {detail.error}
      </Callout>
    );
  const a = editing?.article || detail.article;
  if (!a)
    return (
      <div className="wb-reader-empty">
        <Empty icon="news" title={t("ttPick")} hint={t("ttPickHint")} />
      </div>
    );
  const shown = view === "delivery" && a.delivery ? "delivery" : "draft";
  return (
    <div className="wb-reader" data-mode="toutiao">
      <div className="wb-reader-bar">
        <div className="wb-reader-heading">
          <h2 className="wb-reader-title">{a.title}</h2>
          <p className="wb-reader-meta">
            <Tag tone={statusTone("toutiao", a.status)}>{statusLabel("toutiao", a.status)}</Tag>
            {a.draft ? (
              <span>
                {t("ttRev", { n: a.draft.rev })} · {formatCount(a.draft.chars)}
                {viewCopy.toutiaoAppText1}
                {draftRoleLabel(a.draft.role)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="wb-reader-tools">
          {!editing ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={EDITOR_COPY.find}
              title={EDITOR_COPY.find + " (Ctrl+F)"}
              aria-keyshortcuts="Control+F"
              onClick={() => finder.openFind("find")}
              icon={<Icon name="search" size={14} />}
            />
          ) : null}
          {!editing ? (
            <SegmentedControl
              id="wb-tt-view"
              label={t("ttDetail")}
              value={shown}
              onChange={setView}
              options={[
                { value: "draft", label: t("ttViewDraft") },
                {
                  value: "delivery",
                  label: t("ttViewDelivery"),
                  disabled: !a.delivery,
                  title: a.delivery ? undefined : t("ttNoDelivery"),
                },
              ]}
            />
          ) : null}
          {!editing &&
          shown === "draft" &&
          a.draft?.text &&
          !a.draft.truncated &&
          onSave &&
          !readOnly ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                reading.enter();
                setEditing({ article: a });
              }}
            >
              {t("editorToggle")}
            </Button>
          ) : null}
        </div>
      </div>
      {a.problem ? (
        <Callout tone="danger" role="alert">
          {a.problem}
        </Callout>
      ) : null}
      {finder.bar}
      <div
        ref={reading.body}
        className="wb-reader-body wb-enter"
        key={a.id + ":" + shown + ":" + (a.draft ? a.draft.rev : 0)}
        tabIndex={0}
      >
        {editing && shown === "draft" && a.draft ? (
          <SourceEditor
            initial={a.draft.text}
            title={t("editorTitle")}
            note={t("ttEditorNote")}
            draftKey={articleDraftKey({ root: a.root, id: a.id })}
            baseRevision={{ rev: a.draft.rev, sha256: a.draft.sha256 }}
            position={reading.position}
            onSave={async (text, baseRevision) => {
              await onSave(text, {
                root: a.root,
                id: a.id,
                expectedRev: baseRevision.rev,
                expectedSha256: baseRevision.sha256,
              });
              reading.leave();
              setEditing(null);
            }}
            onCancel={() => {
              reading.leave();
              setEditing(null);
            }}
            onStateChange={onEditState}
          />
        ) : shown === "delivery" ? (
          <pre className="wb-prewrap wb-tt-delivery">{a.delivery}</pre>
        ) : a.draft && a.draft.text ? (
          <>
            {a.draft.truncated ? (
              <Callout tone="warning">{t("truncated", { size: "200 KB" })}</Callout>
            ) : null}
            <Manuscript text={a.draft.text} annotationId="wb-tt" />
          </>
        ) : (
          <Empty icon="pen" hint={t("ttNoDraft")} />
        )}
      </div>
    </div>
  );
}
