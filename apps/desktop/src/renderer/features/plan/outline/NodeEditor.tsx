import React, { useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import type { ChapterPlan, PlanNodeBase, Beat, OutlineNodeView } from "@zhizhang/fanqie/outline";
import type { Entity, Thread } from "@zhizhang/fanqie/bible";
import { P, TextField } from "../shared";
export type NodeFields = Partial<Omit<ChapterPlan, "id" | "rev" | "provenance">>;
const editableFields: Array<"title" | "goal" | "conflict" | "hook"> = [
  "title",
  "goal",
  "conflict",
  "hook",
];
export function NodeEditor({
  node,
  entities,
  threads,
  level,
  readonly,
  onSave,
  onCancel,
  onDirty,
}: {
  node?: PlanNodeBase | ChapterPlan;
  entities: Entity[];
  threads: Thread[];
  level: OutlineNodeView["level"];
  readonly: boolean;
  onSave: (fields: NodeFields) => Promise<void>;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(node?.title ?? ""),
    [summary, setSummary] = useState(node?.summary ?? ""),
    [goal, setGoal] = useState(node?.goal ?? ""),
    [conflict, setConflict] = useState(node?.conflict ?? ""),
    [hook, setHook] = useState(node?.hook ?? ""),
    [notes, setNotes] = useState(node?.notes ?? ""),
    [target, setTarget] = useState(String(node?.wordTarget ?? ""));
  const [cast, setCast] = useState(node?.cast ?? []),
    [pov, setPov] = useState(node && "pov" in node ? (node.pov ?? "") : ""),
    [location, setLocation] = useState(node && "location" in node ? (node.location ?? "") : "");
  const [payoffs, setPayoffs] = useState(node?.payoffs?.join("\n") ?? ""),
    [plant, setPlant] = useState(
      node?.plant?.flatMap((ref) => (ref.thread ? [ref.thread] : [])) ?? [],
    ),
    [pay, setPay] = useState(node?.pay?.flatMap((ref) => (ref.thread ? [ref.thread] : [])) ?? []);
  const chapter = node && "beats" in node ? node : undefined;
  const [beats, setBeats] = useState<Beat[]>(chapter?.beats ?? []),
    [mustInclude, setMustInclude] = useState(chapter?.mustInclude?.join("\n") ?? ""),
    [mustAvoid, setMustAvoid] = useState(chapter?.mustAvoid?.join("\n") ?? ""),
    [timeAnchor, setTimeAnchor] = useState(chapter?.timeAnchor ?? ""),
    [emotion, setEmotion] = useState(chapter?.emotion ?? "");
  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [settled, setSettled] = useState(node?.planStatus === "settled");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave({
        title,
        summary,
        goal,
        conflict,
        hook,
        notes,
        wordTarget: target ? Number(target) : undefined,
        cast,
        payoffs: lines(payoffs),
        plant: plant.map((thread) => ({ thread })),
        pay: pay.map((thread) => ({ thread })),
        ...(level === "chapter"
          ? {
              pov: pov || undefined,
              location: location || undefined,
              beats,
              mustInclude: lines(mustInclude),
              mustAvoid: lines(mustAvoid),
              timeAnchor: timeAnchor || undefined,
              emotion: emotion || undefined,
            }
          : {}),
        planStatus: settled ? "settled" : "draft",
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      data-testid="node-editor"
      onChange={() => onDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <TextField
        label={P["plan.title"]}
        value={title}
        onChange={setTitle}
        testId="node-title"
        disabled={readonly}
      />
      <TextField
        label={P["plan.summary"]}
        value={summary}
        onChange={setSummary}
        multiline
        disabled={readonly}
      />
      <TextField
        label={P["plan.goal"]}
        value={goal}
        onChange={setGoal}
        multiline
        disabled={readonly}
      />
      <TextField
        label={P["plan.conflict"]}
        value={conflict}
        onChange={setConflict}
        multiline
        disabled={readonly}
      />
      <TextField label={P["plan.hook"]} value={hook} onChange={setHook} disabled={readonly} />
      <TextField label={P["plan.target"]} value={target} onChange={setTarget} disabled={readonly} />
      <label className="zz-plan-field">
        {P["plan.cast"]}
        <select
          multiple
          value={cast}
          disabled={readonly}
          onChange={(event) =>
            setCast([...event.target.selectedOptions].map((option) => option.value))
          }
        >
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      </label>
      <label className="zz-plan-field">
        {P["plan.pov"]}
        <select value={pov} disabled={readonly} onChange={(event) => setPov(event.target.value)}>
          <option value="">{P["plan.none"]}</option>
          {entities
            .filter((entity) => entity.kind === "character")
            .map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
        </select>
      </label>
      <label className="zz-plan-field">
        {P["plan.location"]}
        <select
          value={location}
          disabled={readonly}
          onChange={(event) => setLocation(event.target.value)}
        >
          <option value="">{P["plan.none"]}</option>
          {entities
            .filter((entity) => entity.kind === "place")
            .map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
        </select>
      </label>
      <TextField
        label={P["plan.payoffs"]}
        value={payoffs}
        onChange={setPayoffs}
        multiline
        disabled={readonly}
      />
      <label className="zz-plan-field">
        {P["plan.plant"]}
        <select
          multiple
          value={plant}
          disabled={readonly}
          onChange={(event) =>
            setPlant([...event.target.selectedOptions].map((option) => option.value))
          }
        >
          {threads.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.title}
            </option>
          ))}
        </select>
      </label>
      <label className="zz-plan-field">
        {P["plan.pay"]}
        <select
          multiple
          value={pay}
          disabled={readonly}
          onChange={(event) =>
            setPay([...event.target.selectedOptions].map((option) => option.value))
          }
        >
          {threads.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.title}
            </option>
          ))}
        </select>
      </label>
      {level === "chapter" ? (
        <>
          <TextField
            label={P["plan.timeAnchor"]}
            value={timeAnchor}
            onChange={setTimeAnchor}
            disabled={readonly}
          />
          <TextField
            label={P["plan.emotion"]}
            value={emotion}
            onChange={setEmotion}
            disabled={readonly}
          />
          <TextField
            label={P["plan.mustInclude"]}
            value={mustInclude}
            onChange={setMustInclude}
            multiline
            disabled={readonly}
          />
          <TextField
            label={P["plan.mustAvoid"]}
            value={mustAvoid}
            onChange={setMustAvoid}
            multiline
            disabled={readonly}
          />
          <fieldset>
            <legend>{P["plan.beats"]}</legend>
            {beats.map((beat, index) => (
              <div key={index} className="zz-plan-card">
                {editableFields.map((field) => (
                  <TextField
                    key={field}
                    label={P[`plan.${field}`]}
                    value={beat[field] ?? ""}
                    disabled={readonly}
                    onChange={(value) =>
                      setBeats(
                        beats.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
                      )
                    }
                  />
                ))}
                <Button
                  disabled={readonly}
                  onClick={() => {
                    setBeats(beats.filter((_, i) => i !== index));
                    onDirty(true);
                  }}
                >
                  {P["plan.delete"]}
                </Button>
              </div>
            ))}
            <Button
              disabled={readonly}
              onClick={() => {
                setBeats([...beats, { title: "", goal: "", conflict: "" }]);
                onDirty(true);
              }}
            >
              {P["plan.addBeat"]}
            </Button>
          </fieldset>
        </>
      ) : null}
      <TextField
        label={P["plan.notes"]}
        value={notes}
        onChange={setNotes}
        multiline
        disabled={readonly}
      />
      <label>
        <input
          type="checkbox"
          checked={settled}
          disabled={readonly}
          onChange={(event) => setSettled(event.target.checked)}
        />
        {P["plan.settle"]}
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="zz-plan-toolbar">
        <Button
          type="submit"
          variant="primary"
          disabled={readonly || busy || !title.trim()}
          data-testid="node-save"
        >
          {P["plan.save"]}
        </Button>
        <Button onClick={onCancel}>{P["plan.cancel"]}</Button>
      </div>
    </form>
  );
}
