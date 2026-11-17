/**
 * 编辑中未保存正文经注入的 DraftStore 落盘（桌面端写进写作文件夹 `.zhizhang/drafts/`）：
 * 打字停顿后写入，重开时提示恢复；保存动作仍归作者，这里只防丢失。
 * 没有写作文件夹时由注入方退化为内存暂存，绝不写 localStorage。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { draftStore } from "../../adapters/index.js";
import type { DraftEntry } from "../../editor/drafts.js";

const PAUSE_MS = 800;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDraftStash(key: string, initial: string, text: string, baseRevision: string) {
  const [offer, setOffer] = useState<DraftEntry | null>(null);
  const [failure, setFailure] = useState("");
  const [base, setBase] = useState(baseRevision);
  const [stashed, setStashed] = useState(initial);
  const settled = useRef(false);
  const writeSeq = useRef(0);
  const latest = useRef({ text, offer, stashed, base });
  latest.current = { text, offer, stashed, base };

  // 打开时异步读草稿；结果到达前编辑器照常可用，“恢复”提示等结果再出现。
  useEffect(() => {
    let alive = true;
    draftStore()
      .read(key)
      .then((draft) => {
        if (alive && draft && draft.text !== initial) setOffer(draft);
      })
      .catch((error: unknown) => {
        if (alive) setFailure(messageOf(error));
      });
    return () => {
      alive = false;
    };
  }, [key, initial]);

  const store = useCallback(
    (value: string) => {
      if (settled.current) return;
      const seq = ++writeSeq.current;
      draftStore()
        .write(key, value, latest.current.base)
        .then(() => {
          if (seq !== writeSeq.current) return;
          setStashed(value);
          setFailure("");
        })
        .catch((error: unknown) => {
          if (seq !== writeSeq.current) return;
          setFailure(messageOf(error));
        });
    },
    [key],
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
    // 关窗前主进程会先处理已发出的 invoke，pagehide 的同步发起足以把最后一次文本写出去。
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [store]);

  const settle = useCallback(() => {
    settled.current = true;
    draftStore()
      .clear(key)
      .catch((error: unknown) => {
        setFailure(messageOf(error));
      });
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
