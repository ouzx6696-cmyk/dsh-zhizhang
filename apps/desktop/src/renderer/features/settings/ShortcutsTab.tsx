import { COPY as viewCopy } from "@writer/ui/copy";
import React from "react";
import { shortcutLabel } from "@writer/ui/keys";

export function ShortcutsTab() {
  return (
    <div>
      <h3>{viewCopy.settingsDialogText25}</h3>
      <p>
        <kbd>{shortcutLabel("Ctrl K")}</kbd>
        {viewCopy.settingsDialogText26}
      </p>
      <p>
        <kbd>{shortcutLabel("Ctrl S")}</kbd>
        {viewCopy.settingsDialogText27}
      </p>
      <p>
        <kbd>{shortcutLabel("Ctrl 1 / 2 / 3")}</kbd>
        {viewCopy.settingsDialogText28}
      </p>
      <p>
        <kbd>Esc</kbd>
        {viewCopy.settingsDialogText29}
      </p>
      <p>{viewCopy.settingsDialogText30}</p>
    </div>
  );
}
