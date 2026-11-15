import React, { useState } from "react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button } from "@zhizhang/ui/primitives";
import type { UpdateStatus } from "../../../shared/views";
import { resetSettings } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
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
    case "downloading":
    case "ready":
      return C.about.updateNext(status.next);
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
  const [checking, setChecking] = useState(false);
  if (!app) return null;
  const check = async () => {
    setChecking(true);
    try {
      const updates = await desktop.updates("check");
      desktopStore.set((s) => ({ app: s.app ? { ...s.app, updates } : null }));
    } catch (error) {
      notifyError(error);
    } finally {
      setChecking(false);
    }
  };
  const diagnostics = async () => {
    const result = await desktop.diagnostics();
    if (result) notify({ tone: "success", text: C.about.diagnosticsDone(result.file) });
  };
  return (
    <div className="zz-stack" data-testid="settings-about">
      <Section title={COPY["app.name"]}>
        <p data-testid="about-version">{C.about.version(app.version, app.platform)}</p>
        <p className="zz-muted" data-testid="about-updates" data-state={app.updates.state}>
          {updateText(app.updates)}
        </p>
        <Button size="sm" loading={checking} disabled={app.updates.state === "unavailable"} onClick={() => void check()}>
          {C.about.check}
        </Button>
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
