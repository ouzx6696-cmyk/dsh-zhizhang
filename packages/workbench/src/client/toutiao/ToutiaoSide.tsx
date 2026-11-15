import React from "react";
import type { ArticleRowView } from "@zhizhang/toutiao/view";
import { TOUTIAO_DELIVERED } from "@zhizhang/ui/status";
import { ActionCard, Empty, Section, StatusTag } from "../shared/components.js";
import type { ToutiaoState } from "./state.js";

export interface ToutiaoSideProps {
  state: ToutiaoState;
  selected: ArticleRowView | null;
  onRefresh: () => Promise<void>;
  onDeliver: (articleDir: string, title: string, body: string) => Promise<unknown>;
}

export function ToutiaoSide({ state, selected, onRefresh, onDeliver }: ToutiaoSideProps) {
  if (!selected) {
    return <Empty title="文章检查器" hint="选择文章后查看质检与交稿状态" icon="info" />;
  }

  const delivered = selected.status === TOUTIAO_DELIVERED;
  const articleDir = state.root ? `${state.root.replace(/[\\/]+$/, "")}/${selected.id}` : selected.id;

  return (
    <aside className="wb-inspector">
      <Section title="文章台账" aside={<StatusTag status={selected.status} mode="toutiao" />}>
        <dl className="wb-facts">
          <div className="wb-fact">
            <dt>题材</dt>
            <dd>{selected.genre}</dd>
          </div>
          <div className="wb-fact">
            <dt>驱动</dt>
            <dd>{selected.driver}</dd>
          </div>
          <div className="wb-fact">
            <dt>质检分</dt>
            <dd>{selected.qaScore != null ? `${selected.qaScore} 分` : "未评分"}</dd>
          </div>
          <div className="wb-fact">
            <dt>更新时间</dt>
            <dd>{selected.updatedAt}</dd>
          </div>
        </dl>
      </Section>
      <Section title="交稿与同步">
        <div className="wb-action-stack">
          <ActionCard
            icon="send"
            title="生成交稿单"
            hint={delivered ? "本文已交稿" : "通过质检后生成最终交稿单"}
            primary={!delivered}
            disabled={delivered || Boolean(state.busyAction)}
            busy={state.busyAction === "deliver"}
            onClick={() => void onDeliver(articleDir, selected.title, "")}
          />
          <ActionCard
            icon="refresh"
            title="刷新台账"
            hint="同步头条文章最新状态"
            disabled={state.loading}
            busy={state.loading}
            onClick={() => void onRefresh()}
          />
        </div>
      </Section>
    </aside>
  );
}
