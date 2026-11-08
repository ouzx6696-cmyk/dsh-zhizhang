import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import { getCommand } from "../../../commands";
import type { WorkspaceContext } from "../../../renderer-contracts";

/** [命令 ID, 按钮文字]；文字省略时用命令自身的名称。 */
type QuickItem = readonly [id: string, label?: string];

/** 按作品状态挑快捷动作，自上而下第一个成立的条件生效，都不成立时用通用组合。 */
const QUICK_ACTIONS: readonly [(context: WorkspaceContext) => boolean, readonly QuickItem[]][] = [
  [
    (c) => c.kind === "article" && c.article?.status === viewCopy.toutiaoAppText4,
    [
      [viewCopy.agentPanelText7, viewCopy.ttContinue],
      [viewCopy.agentPanelText8, viewCopy.agentPanelText9],
    ],
  ],
  [
    (c) => c.kind === "article",
    [
      [viewCopy.agentPanelText7, viewCopy.ttContinue],
      [viewCopy.agentPanelText10, viewCopy.ttReview],
      [viewCopy.ttQa],
    ],
  ],
  [
    (c) => Boolean(c.chapter) && !c.outlineReady,
    [[viewCopy.agentPanelText11], [viewCopy.agentPanelText12, viewCopy.agentPanelText13]],
  ],
  [
    (c) => Boolean(c.hasCandidate),
    [
      [viewCopy.agentPanelText14],
      [viewCopy.agentPanelText10, viewCopy.agentPanelText15],
      [viewCopy.agentPanelText16, viewCopy.deliverRevise],
    ],
  ],
  [
    (c) => Boolean(c.review?.verdict) && c.review?.verdict !== viewCopy.reviewPass,
    [
      [viewCopy.agentPanelText16, viewCopy.deliverRevise],
      [viewCopy.agentPanelText10, viewCopy.agentPanelText17],
    ],
  ],
  [
    (c) => c.chapter?.status === "final",
    [
      [viewCopy.agentPanelText7, viewCopy.deliverContinue],
      [viewCopy.agentPanelText18, viewCopy.agentPanelText19],
    ],
  ],
];
const QUICK_DEFAULT: readonly QuickItem[] = [
  [viewCopy.agentPanelText7, viewCopy.agentPanelText20],
  [viewCopy.agentPanelText10, viewCopy.agentPanelText15],
  [viewCopy.ttQa, viewCopy.agentPanelText21],
];

export function quickActions(context: WorkspaceContext) {
  const items = QUICK_ACTIONS.find(([applies]) => applies(context))?.[1] ?? QUICK_DEFAULT;
  return items.map(([id, label]) => {
    const command = getCommand(id);
    return { ...command, label: label ?? command.label };
  });
}
