import React from "react";
import type { ArticleRowView } from "@zhizhang/toutiao/view";
import { ARTICLE_STEPS, articleProgress } from "@zhizhang/ui/status";
import { Steps } from "@zhizhang/ui/primitives";
import { Callout, Empty, Skeleton, StatusDot, StatusTag, cx } from "../shared/components.js";
import type { ToutiaoAction, ToutiaoState } from "./state.js";

export interface ToutiaoAppProps {
  state: ToutiaoState;
  rows: readonly ArticleRowView[];
  selected: ArticleRowView | null;
  dispatch: React.Dispatch<ToutiaoAction>;
}

export function ToutiaoApp({ state, rows, selected, dispatch }: ToutiaoAppProps) {
  if (state.phase === "boot" && state.loading) {
    return <Skeleton lines={6} />;
  }

  if (state.error) {
    return (
      <Callout tone="danger" role="alert">
        {state.error}
      </Callout>
    );
  }

  return (
    <div className="wb-toutiao">
      <aside className="wb-toutiao-list" aria-label="文章列表">
        {rows.length ? (
          <ul className="wb-chapter-list" role="listbox" aria-label="头条文章" data-testid="article-list">
            {rows.map((row) => {
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
                    className={cx("wb-chapter-item", active && "wb-chapter-item-on")}
                    onClick={() => dispatch({ type: "select", id: row.id })}
                  >
                    <StatusDot status={row.status} mode="toutiao" />
                    <span className="wb-chapter-title">{row.title || row.id}</span>
                    <span className="wb-chapter-meta">
                      {row.qaScore != null ? `${row.qaScore} 分` : row.genre}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="暂无头条文章" hint="新建选题后将在此展示进度" icon="news" />
        )}
      </aside>
      <main className="wb-toutiao-main">
        {selected ? (
          <div className="wb-toutiao-detail">
            <header className="wb-reader-head">
              <div className="wb-reader-title-group">
                <h2>{selected.title || selected.id}</h2>
                <StatusTag status={selected.status} mode="toutiao" />
              </div>
              <span className="wb-muted">
                {selected.genre} · {selected.driver}
              </span>
            </header>
            <Steps
              steps={[...ARTICLE_STEPS]}
              current={articleProgress({ status: selected.status })}
              label="头条写作阶段"
            />
            {state.lastDeliveryPath ? (
              <Callout tone="success">交稿单已生成：{state.lastDeliveryPath}</Callout>
            ) : null}
          </div>
        ) : (
          <Empty title="请选择文章" hint="从左侧列表选择一篇头条文章查看详情" icon="news" />
        )}
      </main>
    </div>
  );
}
