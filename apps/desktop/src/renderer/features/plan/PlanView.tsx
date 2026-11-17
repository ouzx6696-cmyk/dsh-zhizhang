import React, { lazy, Suspense } from "react";
import { Button } from "@zhizhang/ui/primitives";
import { desktopStore, useDesktop } from "../../state/store";
import { canLeave } from "../../state/controller";
import { P } from "./shared";
import "./plan.css";
const OutlinePage = lazy(() =>
  import("./outline/OutlinePage").then((m) => ({ default: m.OutlinePage })),
);
const LibraryPage = lazy(() =>
  import("./library/LibraryPage").then((m) => ({ default: m.LibraryPage })),
);
const PendingPage = lazy(() =>
  import("./review/PendingPage").then((m) => ({ default: m.PendingPage })),
);
const ImportPage = lazy(() =>
  import("./import/ImportPage").then((m) => ({ default: m.ImportPage })),
);
const ChecksPage = lazy(() =>
  import("./checks/ChecksPage").then((m) => ({ default: m.ChecksPage })),
);
const HistoryPage = lazy(() =>
  import("./history/HistoryPage").then((m) => ({ default: m.HistoryPage })),
);
type PlanTab = "outline" | "library" | "pending" | "import" | "checks" | "history";
const tabs: PlanTab[] = ["outline", "library", "pending", "import", "checks", "history"];
export function PlanView({ work }: { work: string }) {
  const tab = useDesktop((state) => state.planTab),
    readonly = useDesktop((state) => Boolean(state.workspace?.readonly));
  return (
    <div className="zz-plan" data-testid="plan-view">
      <nav aria-label={P["plan.outline.title"]}>
        {tabs.map((item) => (
          <Button
            key={item}
            data-testid={`plan-tab-${item}`}
            aria-pressed={item === tab}
            onClick={() =>
              void canLeave().then((ok) => {
                if (ok) desktopStore.set({ planTab: item, planFocus: undefined });
              })
            }
          >
            {P[`plan.tab.${item}`]}
          </Button>
        ))}
      </nav>
      {readonly ? <p role="status">{P["plan.readonly"]}</p> : null}
      <Suspense fallback={<p>{P["plan.loading"]}</p>}>
        <div className="zz-plan-page" key={work + tab}>
          {tab === "outline" ? (
            <OutlinePage work={work} readonly={readonly} />
          ) : tab === "library" ? (
            <LibraryPage work={work} readonly={readonly} />
          ) : tab === "pending" ? (
            <PendingPage work={work} readonly={readonly} />
          ) : tab === "import" ? (
            <ImportPage work={work} readonly={readonly} />
          ) : tab === "checks" ? (
            <ChecksPage work={work} />
          ) : (
            <HistoryPage work={work} readonly={readonly} />
          )}
        </div>
      </Suspense>
    </div>
  );
}
