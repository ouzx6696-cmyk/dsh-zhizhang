import { fanqie } from "../shared/api.js";
import { newRequestId } from "../../../../ui/src/request.js";
import { diagnosticCopy, t } from "../../../../ui/src/copy.js";

export function messageOf(err) {
  if (!err) return "";
  if (err.code === "forbidden") return t("forbiddenHint");
  if (err.code === "rate_limited") return t("rateLimitedHint");
  return (
    (err.code && err.code !== "network" && err.code !== "timeout" ? "[" + err.code + "] " : "") +
    (err.message || String(err))
  );
}

/** 面板动作集：采纳、章节流转、投递、保存与合并。全部绑定当前已加载版本。 */
export function createFanqieActions({ ref, viewRef, alive, refresh, dispatch }) {
  const notify = (tone, text) => dispatch({ type: "notice", tone, text });
  return {
    refresh: () => {
      if (!dispatch({ type: "reloadBodies" })) return;
      return refresh({ projects: true });
    },
    dispatch,
    notify,
    /** Adopt a candidate through the same Accept gates as the tool. */
    async accept(cand, opts, target) {
      const s = ref.current;
      if (s.edit?.dirty || s.edit?.saving) throw new Error(diagnosticCopy.finishEditing);
      if (
        !target ||
        target.selection !== s.selection ||
        target.projectId !== s.projectId ||
        target.work !== s.work ||
        target.cand?.id !== cand.id
      )
        throw new Error("当前作品或候选已切换，请重新确认。");
      const chapterMeta = target.meta;
      const isEdit = !!cand.editOf;
      try {
        const data = await fanqie.accept({
          base: s.projectId || undefined,
          work: s.work,
          candidate: cand.id,
          expectedRevision:
            chapterMeta && chapterMeta.id === cand.chapterId ? chapterMeta.revision : undefined,
          confirm: true,
          force: !!opts.force,
          skipBrief: !!opts.skipBrief,
          acceptAfterEdit: isEdit,
          confirmAcceptAfterEdit: isEdit,
        });
        if (alive.current && ref.current.selection === s.selection) {
          dispatch({ type: "closeDialog" });
          dispatch({ type: "readerView", view: s.readerView === "split" ? "split" : "official" });
          dispatch({ type: "reloadBodies" });
          notify("success", data.receipt || t("acceptDone"));
        }
      } finally {
        // A timeout may still have committed server-side: reconcile before any retry.
        if (alive.current) {
          if (ref.current.selection === s.selection) dispatch({ type: "reloadBodies" });
          await refresh({ soft: false });
        }
      }
    },
    /** Review / finalize / acknowledge bound to the revision actually loaded. */
    async chapterAction(kind, extra, target) {
      const s = ref.current;
      if (s.edit?.dirty || s.edit?.saving) throw new Error(diagnosticCopy.finishEditing);
      const meta = target?.meta;
      if (
        !target ||
        target.selection !== s.selection ||
        target.projectId !== s.projectId ||
        target.work !== s.work ||
        target.chapterId !== s.chapterId ||
        meta?.id !== s.chapterId ||
        !meta?.revision ||
        s.chapter.status !== "ready" ||
        s.chapter.truncated ||
        s.chapter.meta?.revision !== meta.revision
      )
        throw new Error("章节或已读版本已变化，请完整加载后重新确认。");
      try {
        await fanqie.chapterAction(kind, {
          base: target.projectId || undefined,
          work: target.work,
          chapter: target.chapterId,
          expectedRevision: meta.revision,
          confirm: true,
          ...(extra || {}),
        });
        if (
          alive.current &&
          ref.current.selection === s.selection &&
          ref.current.chapterId === s.chapterId
        ) {
          dispatch({ type: "closeDialog" });
          dispatch({ type: "reloadBodies" });
          notify("success", t("actionDone"));
        }
      } finally {
        // A failed or timed-out lifecycle write may already have committed.
        if (alive.current) {
          if (ref.current.selection === s.selection) dispatch({ type: "reloadBodies" });
          await refresh({ soft: false });
        }
      }
    },
    /** 写作 Agent：把固定指令投递为对话里的一条消息；正文仍由 Agent 在会话里写 */
    async deliver(action, chapterId) {
      const s = ref.current;
      if (!s.work) return false;
      const requestId = newRequestId("wb");
      dispatch({ type: "deliver", value: { busy: action, message: null, error: null } });
      try {
        await fanqie.deliver({
          base: s.projectId || undefined,
          work: s.work,
          chapter: chapterId || undefined,
          action,
          confirm: true,
          requestId,
        });
        if (!alive.current || ref.current.selection !== s.selection) return true;
        dispatch({ type: "deliver", value: { busy: "", message: t("deliverDone") } });
        dispatch({ type: "notice", tone: "success", text: t("deliverDone") });
        return true;
      } catch (err) {
        if (!alive.current || ref.current.selection !== s.selection) return false;
        dispatch({ type: "deliver", value: { busy: "", error: messageOf(err) } });
        dispatch({
          type: "notice",
          tone: "danger",
          text: t("deliverFailed", { reason: messageOf(err) }),
        });
        return false;
      }
    },
    async saveChapter({ body, expectedRevision, candidateId, scope, force }) {
      const s = ref.current;
      if (!s.work || !s.chapterId) throw new Error(t("chapterSaveMissing"));
      if (
        scope &&
        (s.projectId !== scope.base || s.work !== scope.work || s.chapterId !== scope.chapter)
      )
        throw new Error("编辑对象已变化，请先保留当前修改再重新打开章节。");
      const data = await fanqie.saveChapter({
        base: s.projectId || undefined,
        work: s.work,
        chapter: s.chapterId,
        body,
        expectedRevision,
        force: force === true,
        ...(candidateId ? { mode: "candidate", editOf: candidateId, draftLabel: "作者修订" } : {}),
      });
      await refresh({ soft: false });
      if (candidateId && data.candidateId) {
        dispatch({ type: "selectCandidate", chapterId: s.chapterId, id: data.candidateId });
        dispatch({ type: "readerView", view: "candidate" });
        notify("success", t("candidateSaved"));
      } else {
        dispatch({ type: "readerView", view: "official" });
        notify("success", t("chapterSaved"));
      }
      return data;
    },
    async unifyPrepare() {
      const s = ref.current;
      const ids = viewRef.current.chapterPending.map((c) => c.id);
      if (!s.work || !s.chapterId || ids.length < 2) return;
      dispatch({ type: "unify", value: { busy: true, message: null, error: null } });
      try {
        const data = await fanqie.unifyPrepare({
          base: s.projectId || undefined,
          work: s.work,
          chapter: s.chapterId,
          candidateIds: ids,
        });
        const brief = data.brief || "";
        try {
          if (navigator.clipboard && navigator.clipboard.writeText)
            await navigator.clipboard.writeText(brief);
          // allow-catch: optional clipboard copy; the visible message retains the next-step instructions.
        } catch {
          /* clipboard permission denied */
        }
        if (
          !alive.current ||
          ref.current.selection !== s.selection ||
          ref.current.chapterId !== s.chapterId
        )
          return;
        dispatch({
          type: "unify",
          value: {
            busy: false,
            message: t("unifyDone", { n: (data.candidateIds || ids).length }),
          },
        });
      } catch (err) {
        if (
          !alive.current ||
          ref.current.selection !== s.selection ||
          ref.current.chapterId !== s.chapterId
        )
          return;
        dispatch({ type: "unify", value: { busy: false, error: messageOf(err) } });
      }
    },
  };
}
