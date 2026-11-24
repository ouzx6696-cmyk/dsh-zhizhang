import React, { useState } from "react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { LibraryPanel } from "./LibraryPanel";
import { ProfilesPanel } from "./ProfilesPanel";
import { TechniqueEditorPanel } from "./TechniqueEditorPanel";

const C = DESKTOP_COPY;
type WarehouseTab = "library" | "editor" | "profiles";

/** 写作技法仓库：拆书参考卡管理、交互式技法逻辑编辑器与番茄/头条写作方法方案管理。 */
export function TechniqueWarehouse() {
  const [tab, setTab] = useState<WarehouseTab>("library");
  const [editorTarget, setEditorTarget] = useState<{ sourceId: string; cardId: string }>({
    sourceId: "",
    cardId: "",
  });

  const openEditor = (sourceId: string, cardId = "") => {
    setEditorTarget({ sourceId, cardId });
    setTab("editor");
  };

  return (
    <main
      className="zz-center-page zz-warehouse"
      data-testid="technique-warehouse"
      aria-label={C.warehouse.title}
    >
      <header className="zz-page-head">
        <div>
          <h1>{C.warehouse.title}</h1>
          <p className="zz-muted">{C.warehouse.subtitle}</p>
        </div>
      </header>

      <nav className="zz-page-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="zz-page-tab"
          aria-selected={tab === "library"}
          data-testid="warehouse-tab-library"
          onClick={() => setTab("library")}
        >
          {C.warehouse.tabLibrary}
        </button>
        <button
          type="button"
          role="tab"
          className="zz-page-tab"
          aria-selected={tab === "editor"}
          data-testid="warehouse-tab-editor"
          onClick={() => setTab("editor")}
        >
          {C.warehouse.tabEditor}
        </button>
        <button
          type="button"
          role="tab"
          className="zz-page-tab"
          aria-selected={tab === "profiles"}
          data-testid="warehouse-tab-profiles"
          onClick={() => setTab("profiles")}
        >
          {C.warehouse.tabProfiles}
        </button>
      </nav>

      {tab === "library" ? (
        <LibraryPanel onOpenEditor={openEditor} />
      ) : tab === "editor" ? (
        <TechniqueEditorPanel
          initialSourceId={editorTarget.sourceId}
          initialCardId={editorTarget.cardId}
        />
      ) : (
        <ProfilesPanel />
      )}
    </main>
  );
}
