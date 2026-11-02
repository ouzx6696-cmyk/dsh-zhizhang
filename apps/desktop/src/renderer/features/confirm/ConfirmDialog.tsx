import { Dialog } from "../../../../../../packages/ui/src/primitives";
import React from "react";
import { AlertCircle } from "lucide-react";
import { settleConfirm, useConfirmRequest } from "../../state/confirm";

export function ConfirmDialog() {
  const request = useConfirmRequest();
  React.useEffect(() => {
    if (!request) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settleConfirm(false);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        settleConfirm(true);
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => document.removeEventListener("keydown", keyboard, true);
  }, [request]);
  if (!request) return null;
  return (
    <Dialog title="确认操作" className="confirm-dialog" onClose={() => settleConfirm(false)}>
      <AlertCircle size={20} />
      <p>{request.message}</p>
      <div className="confirm-actions">
        <button autoFocus onClick={() => settleConfirm(false)}>
          {request.cancelLabel || "取消"}
        </button>
        <button className="primary" onClick={() => settleConfirm(true)}>
          {request.confirmLabel || "继续"}
        </button>
      </div>
    </Dialog>
  );
}
