/**
 * Keeps the source editor's unsaved text in local storage after a short pause in typing, and offers
 * a draft left behind by an earlier session. Saving stays with the author; this only prevents loss.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@zhizhang/ui/notify";
import {
  clearDraft,
  otherDraftKeys,
  readDraft,
  writeDraft,
  type DraftEntry,
} from "../../editor/drafts.js";
import { confirmAction } from "./confirm.js";
import { WORKBENCH_COPY } from "@zhizhang/ui/copy";

const PAUSE_MS = 800;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openDraft(key: string, initial: string): { offer: DraftEntry | null; failure: string } {
  try {
    const draft = readDraft(key);
    return { offer: draft && draft.text !== initial ? draft : null, failure: "" };
  } catch (error) {
    return { offer: null, failure: messageOf(error) };
  }
}

function offerCleanup(key: string, retry: () => void): void {
  const others = otherDraftKeys(key);
  notify({
    tone: "danger",
    text: WORKBENCH_COPY.editor.stashFull,
    action: others.length
      ? {
          label: WORKBENCH_COPY.editor.clearOtherDrafts,
          run: async () => {
            if (
              !(await confirmAction(WORKBENCH_COPY.editor.clearOtherDraftsConfirm(others.length)))
            )
              return;
            for (const other of otherDraftKeys(key)) clearDraft(other);
            retry();
          },
        }
      : undefined,
  });
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

export function useDraftStash(key: string, initial: string, text: string, baseRevision: string) {
  const [opened] = useState(() => openDraft(key, initial));
  const [offer, setOffer] = useState<DraftEntry | null>(opened.offer);
  const [failure, setFailure] = useState(opened.failure);
  const [base, setBase] = useState(baseRevision);
  const [stashed, setStashed] = useState(initial);
  const settled = useRef(false);
  const latest = useRef({ text, offer, stashed, base });
  latest.current = { text, offer, stashed, base };

  const store = useCallback(
    (value: string) => {
      if (settled.current) return;
      try {
        if (value === initial) clearDraft(key);
        else writeDraft(key, value, latest.current.base);
        setStashed(value);
        setFailure("");
      } catch (error) {
        setFailure(messageOf(error));
        if (isQuotaError(error)) offerCleanup(key, () => store(latest.current.text));
      }
    },
    [key, initial],
  );

  useEffect(() => {
    if (offer || text === stashed) return undefined;
    const timer = setTimeout(() => store(text), PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, offer, stashed, store]);

  useEffect(() => {
    const flush = () => {
      const current = latest.current;
      if (!current.offer && current.text !== current.stashed) store(current.text);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [store]);

  const settle = useCallback(() => {
    settled.current = true;
    try {
      clearDraft(key);
    } catch (error) {
      setFailure(messageOf(error));
    }
  }, [key]);

  return {
    offer,
    failure,
    stashed,
    base,
    restore: useCallback(() => {
      const draft = latest.current.offer;
      setOffer(null);
      if (!draft) return latest.current.text;
      setBase(draft.baseRevision);
      return draft.text;
    }, []),
    drop: useCallback(() => {
      setOffer(null);
      store(latest.current.text);
    }, [store]),
    settle,
  };
}
