import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import { Icon, cx } from "./components.js";

export type FindMode = "" | "find" | "replace";

export interface FindController {
  mode: FindMode;
  query: string;
  replacement: string;
  matchCase: boolean;
  open: (mode?: Exclude<FindMode, "">, seed?: string) => void;
  close: () => void;
  setQuery: (value: string) => void;
  setReplacement: (value: string) => void;
  toggleMatchCase: () => void;
  focusTick: number;
}

export function useFind(): FindController {
  const [mode, setMode] = useState<FindMode>("");
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  const open = useCallback((nextMode: Exclude<FindMode, ""> = "find", seed = "") => {
    setMode(nextMode);
    if (seed) setQuery(seed);
    setFocusTick((tick) => tick + 1);
  }, []);

  const close = useCallback(() => {
    setMode("");
  }, []);

  const toggleMatchCase = useCallback(() => {
    setMatchCase((prev) => !prev);
  }, []);

  return {
    mode,
    query,
    replacement,
    matchCase,
    open,
    close,
    setQuery,
    setReplacement,
    toggleMatchCase,
    focusTick,
  };
}

export function isShortcut(event: KeyboardEvent, key: string): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === key.toLowerCase();
}

export function typingElsewhere(event: KeyboardEvent, root: HTMLElement | null): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (root && root.contains(target)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export interface FindBarProps {
  find: FindController;
  label?: string;
  index: number;
  total: number;
  status?: string;
  onStep: (direction: 1 | -1) => void;
  onReplace?: () => void;
  onReplaceAll?: () => void;
  onClose: () => void;
  canReplace?: boolean;
}

export function FindBar({
  find,
  label = "查找与替换",
  index,
  total,
  status,
  onStep,
  onReplace,
  onReplaceAll,
  onClose,
  canReplace = false,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [find.focusTick]);

  const countText = status ?? (find.query ? (total > 0 ? `${index + 1} / ${total}` : "0 / 0") : "");

  return (
    <div className="wb-find-bar" role="region" aria-label={label}>
      <div className="wb-find-row">
        <input
          ref={inputRef}
          type="search"
          className="wb-find-input"
          value={find.query}
          placeholder="查找…"
          aria-label="查找文本"
          onChange={(event) => find.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onStep(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <button
          type="button"
          className={cx("wb-icon-button", find.matchCase && "wb-icon-button-on")}
          aria-pressed={find.matchCase}
          title="区分大小写"
          onClick={find.toggleMatchCase}
        >
          Aa
        </button>
        <span className="wb-find-count" aria-live="polite">
          {countText}
        </span>
        <Button variant="secondary" onClick={() => onStep(-1)} disabled={!total} title="上一处">
          <Icon name="up" size={14} />
        </Button>
        <Button variant="secondary" onClick={() => onStep(1)} disabled={!total} title="下一处">
          <Icon name="down" size={14} />
        </Button>
        <Button variant="secondary" onClick={onClose} title="关闭">
          <Icon name="close" size={14} />
        </Button>
      </div>
      {canReplace && find.mode === "replace" ? (
        <div className="wb-find-row">
          <input
            type="text"
            className="wb-find-input"
            value={find.replacement}
            placeholder="替换为…"
            aria-label="替换文本"
            onChange={(event) => find.setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onReplace?.();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <Button variant="secondary" onClick={onReplace} disabled={!total}>
            替换
          </Button>
          <Button variant="secondary" onClick={onReplaceAll} disabled={!total}>
            全部替换
          </Button>
        </div>
      ) : null}
    </div>
  );
}
