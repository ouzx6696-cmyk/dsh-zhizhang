import React, { useEffect, useState } from "react";
import { Bookmark, PenLine, Search, Wrench } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import type { SessionIntent } from "../../../shared/views";
import { modelReady, openDock, sendMessage } from "../../state/controller";
import { desktopStore, useDesktop } from "../../state/store";
import { notifyError } from "../../format";

interface SelectionBox {
  text: string;
  top: number;
  left: number;
}

/**
 * 划词协作浮条：在正文中选中一段文字后浮现。
 * 遵循“作者是裁判”红线：只把选区写入 focus.selection 并向助手发出诊断/润色/修订指令，绝不直接改动正文。
 */
export function SelectionToolbar({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const settings = useDesktop((s) => s.settings);
  const [box, setBox] = useState<SelectionBox | null>(null);

  useEffect(() => {
    const update = () => {
      const container = containerRef.current;
      const sel = window.getSelection();
      if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0) {
        setBox(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setBox(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 4 || text.length > 2000) {
        setBox(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setBox(null);
        return;
      }
      const top = Math.max(58, rect.top - 46);
      const left = Math.min(window.innerWidth - 220, Math.max(180, rect.left + rect.width / 2));
      setBox({ text, top, left });
    };

    const onMouseUp = () => window.setTimeout(update, 10);
    const onKeyUp = () => window.setTimeout(update, 10);
    const onScroll = () => setBox(null);

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [containerRef]);

  if (!box) return null;

  const dispatchAction = async (prompt: string, intent?: SessionIntent, onlyAttach = false) => {
    const prev = desktopStore.get().focus;
    desktopStore.set({
      focus: {
        ...prev,
        selection: { text: box.text.slice(0, 1200) },
      },
      zenMode: false,
    });
    openDock("assistant");
    window.getSelection()?.removeAllRanges();
    setBox(null);

    if (onlyAttach || !modelReady(settings)) {
      notify({ tone: "info", text: C.selection.attached(box.text.length) });
      return;
    }
    try {
      await sendMessage(prompt, intent);
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <div
      className="zz-sel-bar"
      role="toolbar"
      aria-label={C.selection.label}
      data-testid="selection-toolbar"
      style={{ top: `${box.top}px`, left: `${box.left}px` }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="zz-sel-bar__btn"
        onClick={() => void dispatchAction(C.selection.promptDiagnose, "diagnose")}
      >
        <Search size={13} aria-hidden="true" />
        {C.selection.diagnose}
      </button>
      <button
        type="button"
        className="zz-sel-bar__btn"
        onClick={() => void dispatchAction(C.selection.promptPolish, "polish")}
      >
        <PenLine size={13} aria-hidden="true" />
        {C.selection.polish}
      </button>
      <button
        type="button"
        className="zz-sel-bar__btn"
        onClick={() => void dispatchAction(C.selection.promptRevise, "diagnose")}
      >
        <Wrench size={13} aria-hidden="true" />
        {C.selection.revise}
      </button>
      <button
        type="button"
        className="zz-sel-bar__btn"
        onClick={() =>
          void dispatchAction(`${C.selection.promptKeep}\n「${box.text}」`, undefined, true)
        }
      >
        <Bookmark size={13} aria-hidden="true" />
        {C.selection.keep}
      </button>
    </div>
  );
}
