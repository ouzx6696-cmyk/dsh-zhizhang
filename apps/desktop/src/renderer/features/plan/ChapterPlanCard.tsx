import React from "react";
import { Button } from "@zhizhang/ui/primitives";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
import { P, usePlanResource } from "./shared";
export function ChapterPlanCard({ work }: { work: string }) {
  const chapter = useDesktop((state) => state.focus.chapter),
    readonly = useDesktop((state) => Boolean(state.workspace?.readonly));
  const data = usePlanResource(
    async () => {
      const outline = await desktop.workbench("fanqie.outline.get", { work });
      const row = outline.nodes.find((row) => row.chapterId === chapter);
      return row ? desktop.workbench("fanqie.outline.node", { work, id: row.id }) : null;
    },
    work,
    false,
    chapter,
  );
  const plan = data.value;
  return (
    <section className="zz-plan-card">
      <h4>{P["plan.currentPlan"]}</h4>
      {plan ? (
        <>
          <strong>{plan.title}</strong>
          <p>{plan.summary}</p>
          <dl>
            <dt>{P["plan.goal"]}</dt>
            <dd>{plan.goal}</dd>
            <dt>{P["plan.conflict"]}</dt>
            <dd>{plan.conflict}</dd>
            <dt>{P["plan.payoffs"]}</dt>
            <dd>{plan.payoffs?.join(" · ")}</dd>
            <dt>{P["plan.hook"]}</dt>
            <dd>{plan.hook}</dd>
            <dt>{P["plan.plant"]}</dt>
            <dd>{plan.plant?.map((ref) => ref.title ?? ref.thread).join(" · ")}</dd>
            <dt>{P["plan.pay"]}</dt>
            <dd>{plan.pay?.map((ref) => ref.title ?? ref.thread).join(" · ")}</dd>
          </dl>
          <Button
            onClick={() =>
              desktopStore.set({ view: "plan", planTab: "outline", planFocus: plan.id })
            }
          >
            {P["plan.openPlan"]}
          </Button>
        </>
      ) : (
        <p>{P["plan.empty"]}</p>
      )}
      {chapter ? (
        <Button
          disabled={readonly}
          onClick={() =>
            void desktop
              .startRun(
                { mode: "fanqie", path: work },
                { kind: "fanqie.ledger", request: { chapterId: chapter, trigger: "manual" } },
              )
              .then(() => desktopStore.set({ dockTab: "pipeline" }))
          }
        >
          {P["plan.startLedger"]}
        </Button>
      ) : null}
    </section>
  );
}
