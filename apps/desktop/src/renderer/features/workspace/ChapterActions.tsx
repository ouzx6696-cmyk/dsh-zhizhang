import React, { useState } from "react";
import { BookOpenText, Check, Ellipsis, Workflow } from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, IconButton, Menu, type MenuItem } from "@zhizhang/ui/primitives";
import { openPipeline } from "../../state/controller";
import { desktopStore } from "../../state/store";

const set = desktopStore.set;

/**
 * 章节条右侧：查找 / 编辑是图标按钮（在 Reader 里），这里给一个主操作 + “更多”菜单。
 * 主操作随状态换：已审 → 定稿（唯一琥珀）；其余 → 发起章节流水线（中性）。另一项收进菜单。
 */
export function ChapterActions({
  chapterId,
  reviewed,
  readonly,
  busy,
  onFinalize,
}: {
  chapterId: string;
  reviewed: boolean;
  readonly: boolean;
  busy: boolean;
  onFinalize: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pipeline = (
    <Button
      size="sm"
      data-testid="chapter-start-pipeline"
      disabled={readonly}
      onClick={() => openPipeline(chapterId)}
    >
      <Workflow size={14} aria-hidden="true" />
      {C.fanqie.startPipeline}
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
    reviewed
      ? {
          id: "pipeline",
          label: <span data-testid="chapter-start-pipeline">{C.fanqie.startPipeline}</span>,
          disabled: readonly,
          onSelect: () => openPipeline(chapterId),
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
