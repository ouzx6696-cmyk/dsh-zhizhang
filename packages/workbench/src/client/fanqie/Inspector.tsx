import React from "react";
import { ActionCard, Empty, Section, StatusTag } from "../shared/components.js";
import type { FanqieAction, FanqieDerived, FanqieState } from "./state.js";

export interface InspectorProps {
  state: FanqieState;
  view: FanqieDerived;
  dispatch: React.Dispatch<FanqieAction>;
  onRefresh: () => Promise<void>;
}

export function Inspector({ state, view, dispatch, onRefresh }: InspectorProps) {
  if (!view.current) {
    return <Empty title="章节检查器" hint="选择章节后查看状态与操作" icon="info" />;
  }
  const current = view.current;
  const isFinal = current.status === "final";

  return (
    <aside className="wb-inspector">
      <Section title="本章状态" aside={<StatusTag status={current.status} mode="fanqie" />}>
        <dl className="wb-facts">
          <div className="wb-fact">
            <dt>章节编号</dt>
            <dd>{current.id}</dd>
          </div>
          <div className="wb-fact">
            <dt>字数统计</dt>
            <dd>{current.wordCount} 字</dd>
          </div>
          <div className="wb-fact">
            <dt>当前版本</dt>
            <dd>{current.revision || "—"}</dd>
          </div>
        </dl>
      </Section>
      <Section title="章节操作">
        <div className="wb-action-stack">
          <ActionCard
            icon="stamp"
            title="定稿本章"
            hint={isFinal ? "当前章节已定稿" : "确认正文无误并锁定为定稿"}
            primary={!isFinal}
            disabled={isFinal || Boolean(state.busyAction)}
            busy={state.busyAction === "finalize"}
            onClick={() =>
              dispatch({ type: "openDialog", dialog: { kind: "finalize", chapterId: current.id } })
            }
          />
          <ActionCard
            icon="refresh"
            title="刷新快照"
            hint="从工作区增量同步最新章节状态"
            disabled={state.loading}
            busy={state.loading}
            onClick={() => void onRefresh()}
          />
        </div>
      </Section>
    </aside>
  );
}
