/**
 * Keeps the source editor's unsaved text in local storage after a short pause in typing, and offers
 * a draft left behind by an earlier session. Saving stays with the author; this only prevents loss.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { clearDraft, pruneDrafts, readDraft, writeDraft } from "./drafts.js";

const PAUSE_MS = 800;

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** A draft for this exact revision that differs from what is on disk, or the storage failure. */
function openDraft(key, initial) {
  try {
    pruneDrafts();
    const draft = readDraft(key);
    return { offer: draft && draft.text !== initial ? draft : null, failure: "" };
  } catch (error) {
    // allow-catch: the failure is returned and shown beside the save status; editing still works.
    return { offer: null, failure: messageOf(error) };
  }
}

export function useDraftStash(key, initial, text) {
  const [opened] = useState(() => openDraft(key, initial));
  const [offer, setOffer] = useState(opened.offer);
  const [failure, setFailure] = useState(opened.failure);
  // The text last kept (or the disk text, which needs no draft), shown as "draft kept".
  const [stashed, setStashed] = useState(initial);
  // Once saved or discarded the draft is gone for good; nothing may write it back afterwards.
  const settled = useRef(false);
  const latest = useRef({ text, offer, stashed });
  latest.current = { text, offer, stashed };

  const store = useCallback(
    (value) => {
      if (settled.current) return;
      try {
        if (value === initial) clearDraft(key);
        else writeDraft(key, value);
        setStashed(value);
        setFailure("");
      } catch (error) {
        // Shown to the author as "draft not kept"; the text stays in the editor.
        setFailure(messageOf(error));
      }
    },
    [key, initial],
  );

  // An offered draft is not overwritten until the author restores or drops it.
  useEffect(() => {
    if (offer || text === stashed) return undefined;
    const timer = setTimeout(() => store(text), PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, offer, stashed, store]);

  // Closing the window, or the editor going away without a decision, keeps what was typed.
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
    /** Takes the offered text; the caller puts it into the editor. */
    restore: useCallback(() => {
      const draft = latest.current.offer;
      setOffer(null);
      return draft.text;
    }, []),
    drop: useCallback(() => {
      setOffer(null);
      store(latest.current.text);
    }, [store]),
    settle,
  };
}
