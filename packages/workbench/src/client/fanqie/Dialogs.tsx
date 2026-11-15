import React from "react";
import { Button, Dialog } from "@zhizhang/ui/primitives";
import { Callout } from "../shared/components.js";
import type { FanqieAction, FanqieState } from "./state.js";

export interface DialogsProps {
  state: FanqieState;
  dispatch: React.Dispatch<FanqieAction>;
  onFinalize: (chapterId: string) => Promise<void>;
  onAcceptCandidate: (chapterId: string, candidateId: string, base: string) => Promise<void>;
}

export function Dialogs({ state, dispatch, onFinalize, onAcceptCandidate }: DialogsProps) {
  const dialog = state.dialog;
  if (!dialog) return null;

  const busy = Boolean(state.busyAction);
  const close = () => {
    if (!busy) dispatch({ type: "closeDialog" });
  };

  if (dialog.kind === "finalize") {
    return (
      <Dialog
        open
        title="确认定稿"
        closeLabel="关闭"
        description={`确定将章节 ${dialog.chapterId} 标记为定稿吗？`}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void onFinalize(dialog.chapterId)}
            >
              {busy ? "处理中…" : "确认定稿"}
            </Button>
          </>
        }
      >
        <Callout tone="info">定稿后该章将作为后续章节一致性检查的稳定基线。</Callout>
      </Dialog>
    );
  }

  const candidateId = dialog.candidateId ?? state.candidateId;
  return (
    <Dialog
      open
      title="采纳候选稿"
      closeLabel="关闭"
      description={`确定采纳候选稿 ${candidateId} 作为章节 ${dialog.chapterId} 的正文吗？`}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || !candidateId}
            onClick={() =>
              void onAcceptCandidate(dialog.chapterId, candidateId, state.chapter.revision)
            }
          >
            {busy ? "处理中…" : "确认采纳"}
          </Button>
        </>
      }
    >
      <Callout tone="warning">采纳操作会覆盖当前正文章节并更新版本基线。</Callout>
    </Dialog>
  );
}
