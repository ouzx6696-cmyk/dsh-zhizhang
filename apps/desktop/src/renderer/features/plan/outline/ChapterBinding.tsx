import React, { useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import type { OutlineNodeView, OutlineOp, OutlineView } from "@zhizhang/fanqie/outline";
import { P } from "../shared";
export function ChapterBinding({
  node,
  outline,
  readonly,
  execute,
}: {
  node: OutlineNodeView;
  outline: OutlineView;
  readonly: boolean;
  execute(ops: OutlineOp[]): Promise<void>;
}) {
  const [chapter, setChapter] = useState("");
  if (node.level !== "chapter") return null;
  return (
    <div className="zz-plan-toolbar">
      {node.chapterId ? (
        <Button
          disabled={readonly}
          onClick={() => void execute([{ type: "chapter.unbind", plan: node.id }])}
        >
          {P["plan.unbind"]}
        </Button>
      ) : (
        <>
          <label>
            {P["plan.unplaced"]}
            <select
              value={chapter}
              onChange={(event) => setChapter(event.target.value)}
              disabled={readonly}
            >
              <option value="">{P["plan.none"]}</option>
              {outline.unplaced.map((row) => (
                <option key={row.chapterId} value={row.chapterId}>
                  {row.title}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={readonly || !chapter}
            onClick={() =>
              void execute([{ type: "chapter.bind", plan: node.id, chapterId: chapter }])
            }
          >
            {P["plan.bind"]}
          </Button>
        </>
      )}
    </div>
  );
}
