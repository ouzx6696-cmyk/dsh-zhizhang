import React from "react";
import { Empty, Section, SegmentedControl, StatusTag } from "../shared/components.js";
import type { FanqieAction, FanqieDerived, FanqieState, PipelineTab } from "./state.js";

const TAB_OPTIONS: readonly { value: PipelineTab; label: string }[] = [
  { value: "overview", label: "总览" },
  { value: "library", label: "素材库" },
  { value: "inspiration", label: "灵感" },
  { value: "writing", label: "写作" },
  { value: "ledger", label: "台账" },
];

export interface PipelineProps {
  state: FanqieState;
  view: FanqieDerived;
  dispatch: React.Dispatch<FanqieAction>;
}

export function Pipeline({ state, view, dispatch }: PipelineProps) {
  return (
    <div className="wb-pipeline">
      <SegmentedControl
        id="fanqie-pipeline"
        value={state.tab}
        options={TAB_OPTIONS}
        label="番茄流水线视图"
        onChange={(tab) => dispatch({ type: "tab", tab })}
      />
      <Section title="全书进度" aside={<span>{view.chapters.length} 章</span>}>
        {view.chapters.length ? (
          <ul className="wb-ledger-list">
            {view.chapters.map((ch) => (
              <li key={ch.id} className="wb-ledger-row">
                <span>{ch.title || ch.id}</span>
                <span>{ch.wordCount} 字</span>
                <StatusTag status={ch.status} mode="fanqie" />
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="暂无章节记录" icon="layers" />
        )}
      </Section>
    </div>
  );
}
