import React from "react";
import { COPY } from "@zhizhang/ui/copy";
import { Empty } from "@zhizhang/ui/primitives";

/** 大纲·设定视图占位；U-01 起接真数据，保持懒加载分块。 */
export function PlanView({ work }: { work: string }) {
  return (
    <div className="zz-plan" data-testid="plan-view" data-work={work}>
      <Empty title={COPY["plan.outline.title"]} description={COPY["plan.outline.placeholder"]} />
    </div>
  );
}
