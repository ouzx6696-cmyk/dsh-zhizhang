import React, { useState } from "react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button } from "@zhizhang/ui/primitives";
import type { UpdateAction, UpdateStatus } from "../../../shared/views";
import { resetSettings } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
import { triggerWebDownload } from "../../state/web-bridge";
import { notifyError, run } from "../../format";
import { Section } from "./fields";

export function updateText(status: UpdateStatus): string {
  switch (status.state) {
    case "unavailable":
      return C.about.updatesUnavailable;
    case "idle":
    case "checking":
    case "latest":
      return C.about.updates[status.state];
    case "available":
      return C.about.updateNext(status.next);
    case "downloading":
      return C.about.downloading(status.percent ?? 0);
    case "ready":
      return C.about.updateReady(status.next);
    case "error":
      return status.message;
    default: {
      const never: never = status;
      return never;
    }
  }
}

export function AboutTab() {
  const app = useDesktop((s) => s.app);
  const [busyAction, setBusyAction] = useState<UpdateAction | "">("");
  if (!app) return null;

  const invokeUpdate = async (action: UpdateAction) => {
    setBusyAction(action);
    try {
      const updates = await desktop.updates(action);
      desktopStore.set((s) => ({ app: s.app ? { ...s.app, updates } : null }));
    } catch (error) {
      notifyError(error);
    } finally {
      setBusyAction("");
    }
  };

  const diagnostics = async () => {
    const result = await desktop.diagnostics();
    if (!result) return;
    if (result.downloadUrl) {
      triggerWebDownload(result.downloadUrl, result.fileName ?? result.file);
    }
    notify({ tone: "success", text: C.about.diagnosticsDone(result.fileName ?? result.file) });
  };

  const { updates } = app;
  const releaseNotes = updates.state === "available" && updates.notes ? updates.notes : "";

  return (
    <div className="zz-stack" data-testid="settings-about">
      <Section title={COPY["app.name"]}>
        <p data-testid="about-version">{C.about.version(app.version, app.platform)}</p>
        <p className="zz-muted zz-tabular" data-testid="about-updates" data-state={updates.state}>
          {updateText(updates)}
        </p>
        {releaseNotes ? <p className="zz-update-notes">{releaseNotes}</p> : null}
        <div className="zz-row">
          {updates.state === "available" ? (
            <Button
              size="sm"
              variant="primary"
              data-testid="updates-download"
              loading={busyAction === "download"}
              onClick={() => void invokeUpdate("download")}
            >
              {C.about.downloadUpdate}
            </Button>
          ) : updates.state === "ready" ? (
            <Button
              size="sm"
              variant="primary"
              data-testid="updates-install"
              loading={busyAction === "install"}
              onClick={() => void invokeUpdate("install")}
            >
              {C.about.installUpdate}
            </Button>
          ) : (
            <Button
              size="sm"
              data-testid="updates-check"
              loading={busyAction === "check" || updates.state === "checking"}
              disabled={updates.state === "unavailable" || updates.state === "downloading"}
              onClick={() => void invokeUpdate("check")}
            >
              {C.about.check}
            </Button>
          )}
        </div>
      </Section>
      <Section title={C.about.support}>
        <div className="zz-row">
          <Button data-testid="diagnostics-export" onClick={() => diagnostics().catch(notifyError)}>
            {C.about.diagnostics}
          </Button>
          <Button variant="danger" data-testid="settings-reset" onClick={() => run(resetSettings)}>
            {C.about.reset}
          </Button>
        </div>
      </Section>
    </div>
  );
}
