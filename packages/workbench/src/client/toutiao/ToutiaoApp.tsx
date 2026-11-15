import React from "react";
import type { ArticleRowView } from "@zhizhang/toutiao/view";
import { WORKBENCH_COPY as W } from "@zhizhang/ui/copy";
import { ARTICLE_STEPS, articleProgress } from "@zhizhang/ui/status";
import { Steps } from "@zhizhang/ui/primitives";
import { Callout, Empty, Skeleton, StatusDot, cx } from "../shared/components.js";
import type { ToutiaoAction, ToutiaoState } from "./state.js";

export interface ArticleListProps {
  state: ToutiaoState;
  rows: readonly ArticleRowView[];
  dispatch: React.Dispatch<ToutiaoAction>;
}

/** 左栏：头条文章列表（与章节列表同一套列表样式）。 */
export function ArticleList({ state, rows, dispatch }: ArticleListProps) {
  if (state.phase === "boot" && state.loading) return <Skeleton lines={6} />;
  if (state.error) return <Callout tone="danger">{state.error}</Callout>;
  if (!rows.length)
    return <Empty title={W.list.emptyArticles} hint={W.list.emptyArticlesHint} icon="news" />;
  return (
    <ul className="wb-list" role="listbox" aria-label={W.list.articles} data-testid="article-list">
      {rows.map((row, index) => {
        const active = row.id === state.selectedId;
        return (
          <li key={row.id}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              data-testid="article-item"
              data-article-id={row.id}
              data-status={row.status}
              className={cx("wb-list-item", active && "wb-list-item-on")}
              onClick={() => dispatch({ type: "select", id: row.id })}
            >
              <StatusDot status={row.status} mode="toutiao" />
              <span className="wb-list-index" aria-hidden="true">
                {W.list.ordinal(index + 1)}
              </span>
              <span className="wb-list-title">{row.title || row.id}</span>
              <span className="wb-list-meta">
                {row.qaScore != null ? W.list.score(row.qaScore) : row.genre}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 文章进度：头条五步 + 交稿单提示。 */
export function ArticleProgress({
  state,
  selected,
}: {
  state: ToutiaoState;
  selected: ArticleRowView;
}) {
  return (
    <div className="wb-article-progress">
      <Steps
        steps={[...ARTICLE_STEPS]}
        current={articleProgress({ status: selected.status })}
        label={W.toutiao.steps}
      />
      <span className="wb-article-meta">{W.toutiao.meta(selected.genre, selected.driver)}</span>
      {state.lastDeliveryPath ? (
        <Callout tone="success">{W.toutiao.delivered(state.lastDeliveryPath)}</Callout>
      ) : null}
    </div>
  );
}
