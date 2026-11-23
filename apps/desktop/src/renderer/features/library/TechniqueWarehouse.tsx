import React, { useState } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { LibraryPanel } from "./LibraryPanel";
import { ProfilesPanel } from "./ProfilesPanel";

type WarehouseTab = "library" | "profiles";

/** 写作技法仓库：拆书参考卡管理与番茄/头条写作方法方案管理。 */
export function TechniqueWarehouse() {
  const [tab, setTab] = useState<WarehouseTab>("library");

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
        <nav className="zz-seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "library"}
            data-testid="warehouse-tab-library"
            onClick={() => setTab("library")}
          >
            {C.warehouse.tabLibrary}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "profiles"}
            data-testid="warehouse-tab-profiles"
            onClick={() => setTab("profiles")}
          >
            {C.warehouse.tabProfiles}
          </button>
        </nav>
      </header>

      {tab === "library" ? <LibraryPanel /> : <ProfilesPanel />}
    </main>
  );
}
