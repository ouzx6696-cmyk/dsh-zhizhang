import { useCallback, useEffect, useRef, useState } from "react";
import { WORKBENCH_COPY as W } from "@zhizhang/ui/copy";
import { IconButton } from "@zhizhang/ui/primitives";
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
  label = W.find.panel,
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

  const countText = status ?? (find.query ? W.find.count(total > 0 ? index + 1 : 0, total) : "");

  return (
    <div className="wb-find" role="region" aria-label={label}>
      <div className="wb-find-row">
        <span className="wb-find-field">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            type="search"
            className="wb-find-input"
            value={find.query}
            placeholder={W.find.placeholder}
            aria-label={W.find.label}
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
          <span className="wb-find-count" aria-live="polite">
            {countText}
          </span>
        </span>
        <button
          type="button"
          className={cx("wb-find-case", find.matchCase && "wb-find-case-on")}
          aria-pressed={find.matchCase}
          title={W.find.matchCase}
          aria-label={W.find.matchCase}
          onClick={find.toggleMatchCase}
        >
          Aa
        </button>
        <IconButton
          size="sm"
          label={W.find.previous}
          onClick={() => onStep(-1)}
          disabled={!total}
          icon={<Icon name="up" size={14} />}
        />
        <IconButton
          size="sm"
          label={W.find.next}
          onClick={() => onStep(1)}
          disabled={!total}
          icon={<Icon name="down" size={14} />}
        />
        <IconButton
          size="sm"
          label={W.find.close}
          onClick={onClose}
          icon={<Icon name="close" size={14} />}
        />
      </div>
      {canReplace && find.mode === "replace" ? (
        <div className="wb-find-row">
          <span className="wb-find-field">
            <input
              type="text"
              className="wb-find-input"
              value={find.replacement}
              placeholder={W.find.replacePlaceholder}
              aria-label={W.find.replaceLabel}
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
          </span>
          <button
            type="button"
            className="zz-btn zz-btn--sm zz-btn--secondary"
            onClick={onReplace}
            disabled={!total}
          >
            {W.find.replace}
          </button>
          <button
            type="button"
            className="zz-btn zz-btn--sm zz-btn--secondary"
            onClick={onReplaceAll}
            disabled={!total}
          >
            {W.find.replaceAll}
          </button>
        </div>
      ) : null}
    </div>
  );
}
