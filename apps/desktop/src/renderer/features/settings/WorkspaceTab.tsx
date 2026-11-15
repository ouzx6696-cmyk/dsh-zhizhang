import React, { useCallback, useEffect, useState } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, Empty } from "@zhizhang/ui/primitives";
import type { RecoverAction, StorageHealth } from "../../../shared/views";
import { chooseWorkspace } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { useDesktop } from "../../state/store";
import { notifyError, run } from "../../format";
import { Section } from "./fields";

export function WorkspaceTab() {
  const workspace = useDesktop((s) => s.workspace);
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const inspect = useCallback(async () => setHealth(await desktop.storageHealth()), []);
  useEffect(() => {
    if (workspace?.configured) inspect().catch(notifyError);
  }, [workspace?.configured, workspace?.root, inspect]);

  const recover = (action: RecoverAction) => run(async () => setHealth(await desktop.recover(action)));
  const backup = async () => {
    setBackingUp(true);
    try {
      const result = await desktop.backup();
      if (result) notify({ tone: "success", text: C.workspace.backupDone(result.dir) });
    } catch (error) {
      notifyError(error);
    } finally {
      setBackingUp(false);
    }
  };
  const clean = health && !health.staleLocks.length && !health.pendingIntents.length && !health.interruptedRuns.length;
  return (
    <div className="zz-stack" data-testid="settings-workspace">
      <Section title={C.workspace.folder}>
        <p data-testid="settings-workspace-root">{workspace?.root || C.workspace.notSet}</p>
        <div className="zz-row">
          <Button data-testid="settings-choose-workspace" onClick={() => run(chooseWorkspace)}>
            {workspace?.configured ? C.workspace.change : C.workspace.choose}
          </Button>
          {workspace?.root ? (
            <Button variant="ghost" onClick={() => run(() => desktop.openPath(workspace.root))}>
              {C.workspace.open}
            </Button>
          ) : null}
        </div>
      </Section>
      <Section title={C.workspace.health} testId="storage-health">
        {clean ? <Empty title={C.workspace.healthy} /> : null}
        {health?.staleLocks.map((lock) => (
          <div key={lock.lockDir} className="zz-row" data-testid="stale-lock">
            <span>{C.workspace.staleLock(lock.lockDir)}</span>
            <Button size="sm" onClick={() => recover({ kind: "clear-lock", lockDir: lock.lockDir })}>
              {C.workspace.clear}
            </Button>
          </div>
        ))}
        {health?.pendingIntents.map((intent) => (
          <div key={intent.dir + intent.id} className="zz-row" data-testid="pending-intent">
            <span>{C.workspace.pendingIntent(intent.dir)}</span>
            <Button size="sm" onClick={() => recover({ kind: "replay-intents", dir: intent.dir })}>
              {C.workspace.replay}
            </Button>
          </div>
        ))}
        {health?.interruptedRuns.map((r) => (
          <div key={r.id} className="zz-row" data-testid="interrupted-run">
            <span>{C.workspace.interrupted(r.kind)}</span>
            <Button size="sm" onClick={() => recover({ kind: "discard-run", runId: r.id, target: r.target })}>
              {C.workspace.discardRun}
            </Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => inspect().catch(notifyError)}>
          {C.workspace.recheck}
        </Button>
      </Section>
      <Section title={C.workspace.backup}>
        <p className="zz-muted">{C.workspace.backupHint}</p>
        <div className="zz-row">
          <Button data-testid="backup-start" loading={backingUp} disabled={!workspace?.configured} onClick={() => void backup()}>
            {C.workspace.backupStart}
          </Button>
          {backingUp ? (
            <Button variant="ghost" onClick={() => run(() => desktop.cancelBackup())}>
              {C.workspace.backupCancel}
            </Button>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
