import React from "react";
import { Button, Dialog } from "@zhizhang/ui/primitives";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { settleConfirm, useConfirmRequest } from "../../state/confirm";

export function ConfirmDialog() {
  const request = useConfirmRequest();
  if (!request) return null;
  return (
    <Dialog
      title={C.confirm.title}
      closeLabel={COPY.close}
      size="sm"
      className="zz-confirm"
      onClose={() => settleConfirm(false)}
      footer={
        <>
          <Button autoFocus data-testid="confirm-cancel" onClick={() => settleConfirm(false)}>
            {request.cancelLabel || COPY.cancel}
          </Button>
          <Button variant="primary" data-testid="confirm-ok" onClick={() => settleConfirm(true)}>
            {request.confirmLabel || C.confirm.ok}
          </Button>
        </>
      }
    >
      <p data-testid="confirm-message">{request.message}</p>
    </Dialog>
  );
}
