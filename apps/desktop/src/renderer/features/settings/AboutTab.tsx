import { COPY as viewCopy, t as viewText } from "@writer/ui/copy";
import { Brand } from "@writer/ui/primitives";
import React from "react";
import { Download } from "lucide-react";
import type { SystemState } from "../../state/store";
import { desktop } from "../../state/desktop";
import { askConfirm } from "../../state/confirm";

type Action = (operation: () => unknown) => Promise<unknown>;

function updateText(updates: SystemState["updates"]) {
  if (updates.state === "available")
    return viewText("settingsDialogText34", { value0: updates.version });
  if (updates.state === "downloaded") return viewCopy.settingsDialogText35;
  if (updates.state === "downloading")
    return viewText("settingsDialogText36", { value0: updates.percent });
  return updates.message || viewCopy.settingsDialogText37;
}

export function AboutTab({
  version,
  updates,
  action,
  canRestart,
}: {
  version: string;
  updates: SystemState["updates"];
  action: Action;
  canRestart: () => boolean;
}) {
  return (
    <div>
      <Brand />
      <h3>
        {viewCopy.settingsDialogText31}
        {version}
      </h3>
      <p>{viewCopy.settingsDialogText32}</p>
      <h3>{viewCopy.settingsDialogText33}</h3>
      <p>{updateText(updates)}</p>
      <div className="button-row">
        <button onClick={() => action(() => desktop.updates())}>
          {viewCopy.settingsDialogText38}
        </button>
        {updates.state === "available" && (
          <button onClick={() => action(() => desktop.updates("download"))}>
            <Download size={16} />
            {viewCopy.settingsDialogText39}
          </button>
        )}
        {updates.state === "downloaded" && (
          <button
            onClick={async () => {
              if (canRestart() && (await askConfirm(viewCopy.settingsDialogText40)))
                void action(() => desktop.updates("install"));
            }}
          >
            {viewCopy.settingsDialogText41}
          </button>
        )}
      </div>
    </div>
  );
}
