import React from "react";
import { WORKBENCH_COPY } from "@zhizhang/ui/copy";
import { Button, Dialog } from "@zhizhang/ui/primitives";

const D = WORKBENCH_COPY.dialogs;
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
        title={D.finalizeTitle}
        closeLabel={D.close}
        description={D.finalizeAsk(dialog.chapterId)}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              {D.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void onFinalize(dialog.chapterId)}
            >
              {busy ? D.busy : D.finalizeOk}
            </Button>
          </>
        }
      >
        <Callout tone="info">{D.finalizeNote}</Callout>
      </Dialog>
    );
  }

  const candidateId = dialog.candidateId ?? state.candidateId;
  return (
    <Dialog
      open
      title={D.acceptTitle}
      closeLabel={D.close}
      description={D.acceptAsk(candidateId ?? "", dialog.chapterId)}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {D.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !candidateId}
            onClick={() =>
              void onAcceptCandidate(dialog.chapterId, candidateId, state.chapter.revision)
            }
          >
            {busy ? D.busy : D.acceptOk}
          </Button>
        </>
      }
    >
      <Callout tone="warning">{D.acceptNote}</Callout>
    </Dialog>
  );
}
