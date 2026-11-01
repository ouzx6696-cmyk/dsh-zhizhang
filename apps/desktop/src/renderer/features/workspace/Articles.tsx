import React, { useEffect } from "react";
import { useToutiao } from "../../../../../../packages/workbench/src/client/toutiao/useToutiao.js";
import {
  ArticleList,
  Body,
  ToutiaoSide,
} from "../../../../../../packages/workbench/src/client/toutiao/ToutiaoApp.jsx";
import { Notices } from "../../../../../../packages/workbench/src/client/shared/common.jsx";
import { Check } from "lucide-react";
import { StatusBadge } from "../../../../../../packages/ui/src/components";
import type { WorkspaceProps } from "../../../renderer-contracts";
import { WorkspaceLayout } from "./WorkspaceLayout";

export function Articles(props: WorkspaceProps) {
  const tt = useToutiao({ onTarget: props.onTarget }),
    a: any = tt.detail.article;
  useEffect(() => {
    props.onContext({
      target: props.target,
      article: a || undefined,
      kind: "article",
    });
  }, [a, tt.selected]);
  const adopt = async () => {
    if (!a) return;
    if (
      window.confirm(
        `确认采用《${a.title}》第 ${a.rev} 版？发布时请按平台要求声明 AI 生成，故事或合成人物须注明虚构演绎。`,
      )
    )
      await tt.actions.adopt(a);
  };
  const stage = !a
    ? 0
    : a.status === "已交稿"
      ? 6
      : a.status === "已验收"
        ? 5
        : a.status === "待验收"
          ? 4
          : a.status === "验收退回"
            ? 3
            : 2;
  return (
    <>
      <WorkspaceLayout
        tab={props.tab}
        setTab={props.setTab}
        drawer={props.drawer}
        setDrawer={props.setDrawer}
        onMethodEditState={props.onMethodEditState}
        agent={props.agent}
        mode="toutiao"
        navigation={
          <>
            <h2>文章</h2>
            <ArticleList
              articles={tt.list.articles}
              statuses={tt.list.statuses || []}
              sel={tt.sel}
              onSelect={tt.actions.select}
            />
          </>
        }
        center={
          <>
            <div className="paper-decisions">
              <StatusBadge mode="toutiao" status={a?.status} />
              <ol className="paper-steps" aria-label="头条进度">
                {["S1 找题", "S2 立项", "S3 标题", "S4 成文", "S5 红笔", "S6 质检", "S7 交稿"].map(
                  (step, index) => (
                    <li
                      key={step}
                      data-state={index < stage ? "done" : index === stage ? "current" : "todo"}
                      aria-current={index === stage ? "step" : undefined}
                    >
                      {step}
                    </li>
                  ),
                )}
              </ol>
              {a?.qa?.length ? (
                <span
                  className="paper-qa"
                  data-pass={a.qa[a.qa.length - 1].pass ? "true" : "false"}
                >
                  质检 {a.qa[a.qa.length - 1].score} 分
                </span>
              ) : null}
              {a && (
                <>
                  <button
                    disabled={!!tt.busy || !!tt.deliverOff || props.readOnly}
                    title={tt.deliverOff || undefined}
                    onClick={() => tt.actions.deliver("revise")}
                  >
                    打回修改
                  </button>
                  <button
                    className="primary"
                    disabled={!a.adoptable || !tt.adoptReady || !!tt.busy || props.readOnly}
                    onClick={adopt}
                  >
                    <Check size={14} />
                    采用
                  </button>
                </>
              )}
            </div>
            <Body detail={tt.detail} />
          </>
        }
        inspector={<ToutiaoSide tt={tt} hideAgent />}
      />
      <Notices notices={tt.notices} onDismiss={tt.actions.dismiss} />
    </>
  );
}
