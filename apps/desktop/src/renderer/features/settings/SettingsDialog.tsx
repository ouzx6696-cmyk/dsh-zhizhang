import React, { useId } from "react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Dialog, Tabs, tabPanelProps } from "@zhizhang/ui/primitives";
import { desktopStore, useDesktop, type SettingsTab } from "../../state/store";
import { AboutTab } from "./AboutTab";
import { AppearanceTab } from "./AppearanceTab";
import { EngineTab } from "./EngineTab";
import { ModelsTab } from "./ModelsTab";
import { WorkspaceTab } from "./WorkspaceTab";

const TABS: SettingsTab[] = ["models", "engine", "appearance", "workspace", "about"];

function isSettingsTab(value: string): value is SettingsTab {
  return TABS.some((tab) => tab === value);
}

export function SettingsDialog() {
  const base = useId();
  const tab = useDesktop((s) => s.settingsTab);
  const settings = useDesktop((s) => s.settings);
  const close = () => desktopStore.set({ settingsOpen: false });
  if (!settings) return null;
  return (
    <Dialog title={COPY["settings.title"]} closeLabel={COPY.close} size="lg" testId="settings-dialog" className="zz-settings" onClose={close}>
      <div className="zz-settings__body">
        <Tabs
          id={base}
          label={COPY["settings.title"]}
          orientation="vertical"
          testId="settings-tab"
          items={TABS.map((id) => ({ id, label: C.settings.tabs[id] }))}
          value={tab}
          onChange={(next) => {
            if (isSettingsTab(next)) desktopStore.set({ settingsTab: next });
          }}
        />
        <div {...tabPanelProps(base, tab, tab)} className="zz-settings__panel">
          {tab === "models" ? <ModelsTab key={settings.models.connections.length} settings={settings} /> : null}
          {tab === "engine" ? <EngineTab settings={settings} /> : null}
          {tab === "appearance" ? <AppearanceTab settings={settings} /> : null}
          {tab === "workspace" ? <WorkspaceTab /> : null}
          {tab === "about" ? <AboutTab /> : null}
        </div>
      </div>
    </Dialog>
  );
}
