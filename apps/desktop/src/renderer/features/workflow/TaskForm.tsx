import React, { useCallback, useEffect, useState } from "react";
import { Play } from "lucide-react";
import { COPY as copy, WORKFLOW_COPY } from "@writer/ui/copy";
import { statusLabel } from "@writer/ui/status";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import { isRecord } from "../../../../../../packages/core/src/parse.js";
import { COMMANDS } from "../../../../../../packages/workbench/src/commands.js";
import type { WorkflowRequest } from "../../../../../../packages/core/src/workflow-config.js";
import { CLASSICS } from "../../../../../../packages/toutiao/src/classics.js";
import { scopeId, type Target } from "../../../context";
import { desktop } from "../../state/desktop";

interface ChapterOption {
  id: string;
  title: string;
  status?: string;
}

/** 章节列表来自工作台快照接口；这里是渲染层读取它的边界，逐行收窄。 */
async function loadChapters(target: Target): Promise<ChapterOption[]> {
  const result = await desktop.request(COMMANDS.snapshot, {
    input: { base: target.root, work: target.work, scope: "work" },
  });
  const data = isRecord(result.data) ? result.data : {};
  if (data.ok === false)
    throw new Error(typeof data.error === "string" ? data.error : WORKFLOW_COPY.chapterFailed);
  // 空作品或需要先选作品时快照里没有章节，表单显示“暂无章节”。
  const snapshot = data.snapshot;
  if (!isRecord(snapshot) || !Array.isArray(snapshot.chapters)) return [];
  return snapshot.chapters.filter(isRecord).flatMap((row) =>
    typeof row.id === "string"
      ? [
          {
            id: row.id,
            title: typeof row.title === "string" ? row.title : row.id,
            status: typeof row.status === "string" ? row.status : undefined,
          },
        ]
      : [],
  );
}

function ChapterSelect({
  target,
  value,
  onChange,
  onError,
}: {
  target: Target;
  value: string;
  onChange: (chapter: string) => void;
  onError: (message: string) => void;
}) {
  const [chapters, setChapters] = useState<ChapterOption[] | null>(null);
  const key = scopeId(target);
  useEffect(() => {
    let alive = true;
    loadChapters(target)
      .then((rows) => {
        if (alive) setChapters(rows);
      })
      .catch((error) => {
        if (alive) onError(errorText(error));
      });
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (chapters?.length && !chapters.some((chapter) => chapter.id === value))
      onChange(chapters[0].id);
  }, [chapters, value, onChange]);
  return (
    <label>
      {copy.workflowChapterId}
      <select
        value={value}
        disabled={!chapters?.length}
        onChange={(event) => onChange(event.target.value)}
      >
        {!chapters?.length && (
          <option value={value}>
            {chapters ? WORKFLOW_COPY.chapterEmpty : WORKFLOW_COPY.chapterLoading}
          </option>
        )}
        {chapters?.map((chapter, index) => (
          <option key={chapter.id} value={chapter.id}>
            {WORKFLOW_COPY.chapterOption(
              index,
              chapter.id,
              chapter.title,
              statusLabel("fanqie", chapter.status),
            )}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 新任务表单：章节从作品章节列表里选，其他字段与原有流水线请求一致。 */
export function TaskForm({
  target,
  request,
  setRequest,
  busy,
  onStart,
  onError,
}: {
  target: Target;
  request: WorkflowRequest;
  setRequest: React.Dispatch<React.SetStateAction<WorkflowRequest>>;
  busy: boolean;
  onStart: () => void;
  onError: (message: string) => void;
}) {
  const field =
    <K extends keyof WorkflowRequest>(key: K) =>
    (value: WorkflowRequest[K]) =>
      setRequest((current) => ({ ...current, [key]: value }));
  const setChapter = useCallback(
    (chapter: string) => setRequest((current) => ({ ...current, chapter })),
    [setRequest],
  );
  const needsChapter = request.kind === "chapter" || request.kind === "ledger";
  const ready = request.instruction.trim() !== "" && (!needsChapter || request.chapter !== "");
  return (
    <form
      className="wf-form"
      onSubmit={(event) => {
        event.preventDefault();
        onStart();
      }}
    >
      <fieldset disabled={busy}>
        <label>
          {copy.workflowKind}
          <select
            value={request.kind}
            onChange={(event) => field("kind")(event.target.value as WorkflowRequest["kind"])}
          >
            {target.mode === "fanqie" ? (
              <>
                <option value="book">{copy.workflowBook}</option>
                <option value="chapter">{copy.workflowChapter}</option>
                <option value="ledger">{copy.workflowLedger}</option>
              </>
            ) : (
              <option value="article">{copy.workflowArticle}</option>
            )}
          </select>
        </label>
        {needsChapter && (
          <ChapterSelect
            target={target}
            value={request.chapter}
            onChange={setChapter}
            onError={onError}
          />
        )}
        <label>
          {copy.workflowInstruction}
          <textarea
            value={request.instruction}
            onChange={(event) => field("instruction")(event.target.value)}
          />
        </label>
        <label>
          {copy.workflowGrade}
          <select
            value={request.grade}
            onChange={(event) => field("grade")(event.target.value as WorkflowRequest["grade"])}
          >
            <option value="economy">{copy.workflowEconomy}</option>
            <option value="standard">{copy.workflowStandard}</option>
            <option value="premium">{copy.workflowPremium}</option>
          </select>
        </label>
        {request.kind === "article" && (
          <>
            <label>
              {copy.workflowLine}
              <select
                value={request.line}
                onChange={(event) => field("line")(event.target.value as WorkflowRequest["line"])}
              >
                <option value="news">{copy.workflowNews}</option>
                <option value="story">{copy.workflowStory}</option>
                <option value="micro">{copy.workflowMicro}</option>
              </select>
            </label>
            {request.line === "story" && (
              <label>
                {copy.workflowClassic}
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const classic = CLASSICS.find((value) => value.id === event.target.value);
                    if (classic) field("source")(classic.source + "\n" + classic.text);
                  }}
                >
                  <option value="">{copy.workflowClassicNone}</option>
                  {CLASSICS.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {copy.workflowSource}
              <textarea
                value={request.source}
                onChange={(event) => field("source")(event.target.value)}
              />
            </label>
            <p className="wf-hint">{copy.workflowSourceNote}</p>
          </>
        )}
        <p className="wf-hint">{copy.workflowCostNote}</p>
      </fieldset>
      <div className="wf-actions">
        <button type="submit" className="primary" disabled={busy || !ready}>
          <Play size={14} aria-hidden="true" />
          {copy.workflowStart}
        </button>
      </div>
    </form>
  );
}
