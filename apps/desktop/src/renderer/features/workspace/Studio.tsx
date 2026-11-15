import React from "react";
import type { TargetItem } from "../../../shared/views";
import { useDesktop } from "../../state/store";
import { FanqieWorkspace } from "./FanqieWorkspace";
import { RightDock } from "./RightDock";
import { ToutiaoWorkspace } from "./ToutiaoWorkspace";

/** 写作台：中栏写作区（番茄/头条按模式）+ 右栏停靠（助手 / 流水线 / 本章）。 */
export function Studio({ item }: { item: TargetItem }) {
  const dockOpen = useDesktop((state) => state.dockOpen);
  const readonly = useDesktop((state) => Boolean(state.workspace?.readonly));
  return (
    <div className="zz-studio" data-dock={dockOpen ? "open" : "closed"}>
      <main className="zz-studio__main" data-testid="workspace" data-mode={item.target.mode}>
        {item.target.mode === "fanqie" ? (
          <FanqieWorkspace target={item.target} readonly={readonly} />
        ) : (
          <ToutiaoWorkspace target={item.target} readonly={readonly} />
        )}
      </main>
      {dockOpen ? <RightDock target={item.target} /> : null}
    </div>
  );
}
