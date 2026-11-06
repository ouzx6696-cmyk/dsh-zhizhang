import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import React from "react";

export function ShortcutsTab() {
  return (
    <div>
      <h3>{viewCopy.settingsDialogText25}</h3>
      <p>
        <kbd>Ctrl K</kbd>
        {viewCopy.settingsDialogText26}
      </p>
      <p>
        <kbd>Ctrl S</kbd>
        {viewCopy.settingsDialogText27}
      </p>
      <p>
        <kbd>Ctrl 1 / 2 / 3</kbd>
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
