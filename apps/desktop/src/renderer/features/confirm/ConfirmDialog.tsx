import { COPY as viewCopy } from "@writer/ui/copy";
import { Dialog } from "@writer/ui/primitives";
import React from "react";
import { AlertCircle } from "lucide-react";
import { settleConfirm, useConfirmRequest } from "../../state/confirm";

export function ConfirmDialog() {
  const request = useConfirmRequest();
  if (!request) return null;
  return (
    <Dialog
      title={viewCopy.confirmDialogText1}
      className="confirm-dialog"
      onClose={() => settleConfirm(false)}
    >
      <AlertCircle size={20} />
      <p>{request.message}</p>
      <div className="confirm-actions">
        <button autoFocus onClick={() => settleConfirm(false)}>
          {request.cancelLabel || viewCopy.cancel}
        </button>
        <button className="primary" onClick={() => settleConfirm(true)}>
          {request.confirmLabel || viewCopy.confirmDialogText2}
        </button>
      </div>
    </Dialog>
  );
}
