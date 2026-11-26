import React, { useState } from "react";
import { BookOpenText, Check, Ellipsis, Workflow } from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, IconButton, Menu, type MenuItem } from "@zhizhang/ui/primitives";
import { openPipeline } from "../../state/controller";
import { desktopStore } from "../../state/store";

const set = desktopStore.set;

/**
 * 章节条右侧：主操作随生命周期衔接：
 * 已审 → 定稿；已定稿 → 定稿记账（写设定集待决）；其余 → 发起章节流水线。
 * 更多菜单统一收纳审读 / 修订 / 记账 / 设定集入口，确保整条创作链路零断层。
 */
export function ChapterActions({
  chapterId,
  status,
  readonly,
  busy,
  onFinalize,
}: {
  chapterId: string;
  status: string;
  readonly: boolean;
  busy: boolean;
  onFinalize: () => void;
}) {
  const [open, setOpen] = useState(false);
  const reviewed = status === "reviewed";
  const finalized = status === "final";

  const pipeline = (
    <Button
      size="sm"
      variant="ghost"
      data-testid="chapter-start-pipeline"
      disabled={readonly}
      onClick={() => openPipeline(chapterId, finalized ? "fanqie.ledger" : "fanqie.chapter")}
    >
      <Workflow size={14} aria-hidden="true" />
      {finalized ? C.fanqie.startLedger : C.fanqie.startPipeline}
    </Button>
  );
  const finalize = (
    <Button
      size="sm"
      variant="primary"
      data-testid="chapter-finalize"
      disabled={readonly || busy}
      onClick={onFinalize}
    >
      <Check size={14} aria-hidden="true" />
      {COPY["fanqie.action.finalize"]}
    </Button>
  );
  const items: MenuItem[] = [
    reviewed || finalized
      ? {
          id: "pipeline",
          label: <span data-testid="chapter-start-pipeline">{C.fanqie.startPipeline}</span>,
          disabled: readonly,
          onSelect: () => openPipeline(chapterId, "fanqie.chapter"),
        }
      : {
          id: "finalize",
          label: (
            <span className="zz-menu__stack" data-testid="chapter-finalize">
              {COPY["fanqie.action.finalize"]}
              <small>{C.fanqie.finalizeHint}</small>
            </span>
          ),
          disabled: true,
        },
    {
      id: "review",
      label: C.fanqie.startReview,
      disabled: readonly,
      onSelect: () => openPipeline(chapterId, "fanqie.review"),
    },
    {
      id: "revise",
      label: C.fanqie.startRevise,
      disabled: readonly,
      onSelect: () => openPipeline(chapterId, "fanqie.revise"),
    },
    ...(!finalized
      ? [
          {
            id: "ledger",
            label: C.fanqie.startLedger,
            disabled: readonly,
            onSelect: () => openPipeline(chapterId, "fanqie.ledger"),
          },
        ]
      : []),
    { id: "sep", label: "", separator: true },
    {
      id: "bible",
      label: (
        <span className="zz-menu__icon-label" data-testid="chapter-open-bible">
          <BookOpenText size={14} aria-hidden="true" />
          {C.fanqie.openBible}
        </span>
      ),
      onSelect: () => set({ dockOpen: true, dockTab: "chapter" }),
    },
  ];
  return (
    <>
      <div className="wb-bar-more zz-menu-root">
        <IconButton
          size="sm"
          label={C.fanqie.more}
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="chapter-more"
          icon={<Ellipsis size={16} />}
          onClick={() => setOpen(!open)}
        />
        {open ? (
          <Menu
            label={C.fanqie.more}
            items={items}
            className="zz-menu--end"
            onClose={() => setOpen(false)}
          />
        ) : null}
      </div>
      <span className="zz-bar-divider" aria-hidden="true" />
      {reviewed ? finalize : pipeline}
    </>
  );
}
