import { ChapterBinding } from "./ChapterBinding";
import { OutlineTree } from "./OutlineTree";
import { BookSettings } from "./BookSettings";
import React, { useState } from "react";
import { Button, Dialog } from "@zhizhang/ui/primitives";
import type {
  OutlineNodeView,
  OutlineOp,
  RemapPreview,
  PlanNodeBase,
} from "@zhizhang/fanqie/outline";
import { desktop } from "../../../state/desktop";
import { useDesktop } from "../../../state/store";
import { askConfirm } from "../../../state/confirm";
import { P, ResourceState, TextField, browserId, usePlanResource, usePlanDirty } from "../shared";
import { NodeEditor, type NodeFields } from "./NodeEditor";

export function OutlinePage({ work, readonly }: { work: string; readonly: boolean }) {
  const focus = useDesktop((state) => state.planFocus);
  const [dirty, setDirty] = useState(false),
    [selected, setSelected] = useState<string[]>(focus ? [focus] : []),
    [message, setMessage] = useState("");
  const [editing, setEditing] = useState<{
    id?: string;
    level: OutlineNodeView["level"];
    parent?: string;
  } | null>(null);
  const [remap, setRemap] = useState<{ preview: RemapPreview; ops: OutlineOp[] } | null>(null);
  const [split, setSplit] = useState(false),
    [splitText, setSplitText] = useState(""),
    [splitAt, setSplitAt] = useState("1");
  const data = usePlanResource(
    async () => {
      const [outline, bible] = await Promise.all([
        desktop.workbench("fanqie.outline.get", { work }),
        desktop.workbench("fanqie.bible.get", { work }),
      ]);
      return { outline, bible };
    },
    work,
    dirty,
  );
  usePlanDirty(dirty, () => {
    setDirty(false);
    setEditing(null);
  });
  const outline = data.value?.outline,
    bible = data.value?.bible;
  const current = outline?.nodes.find((node) => node.id === selected[0]);
  const nodeData = usePlanResource(
    async () => {
      if (!editing?.id) return null;
      // 公共视图只含树字段；编辑字段由完整节点读取命令返回。
      return desktop.workbench("fanqie.outline.node", { work, id: editing.id });
    },
    work,
    dirty,
    editing?.id ?? "new",
  );
  const execute = async (ops: OutlineOp[], token?: string) => {
    if (!outline) return;
    setMessage("");
    try {
      if (token) await desktop.workbench("fanqie.outline.remapCommit", { work, ops, token });
      else {
        const preview = await desktop.workbench("fanqie.outline.remapPreview", { work, ops });
        if (preview.moves.length) {
          setRemap({ preview, ops });
          return;
        }
        await desktop.workbench("fanqie.outline.apply", { work, ops, expectedRev: outline.rev });
      }
      setDirty(false);
      setEditing(null);
      setRemap(null);
      data.refresh();
      nodeData.refresh();
      setMessage(P["plan.moveDone"]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const create = async (level: OutlineNodeView["level"]) => {
    if (dirty && !(await askConfirm(P["plan.leaveConfirm"]))) return;
    const parent =
      level === "volume"
        ? undefined
        : level === "act"
          ? current?.level === "volume"
            ? current.id
            : current?.parent
          : current?.level === "act"
            ? current.id
            : current?.level === "chapter"
              ? current.parent
              : undefined;
    if (level !== "volume" && !parent) return;
    setDirty(false);
    setEditing({ level, parent });
  };
  const save = async (fields: NodeFields) => {
    if (!editing || !outline) return;
    if (editing.id && current)
      await execute([
        { type: "node.update", id: editing.id, expectedRev: current.rev, patch: fields },
      ]);
    else {
      const id = browserId(
        editing.level === "volume" ? "vol" : editing.level === "act" ? "act" : "pl",
      );
      const node: PlanNodeBase = {
        id,
        title: fields.title ?? "",
        summary: fields.summary,
        goal: fields.goal,
        conflict: fields.conflict,
        hook: fields.hook,
        notes: fields.notes,
        wordTarget: fields.wordTarget,
        cast: fields.cast,
        planStatus: fields.planStatus ?? "draft",
        provenance: { source: "author", at: new Date().toISOString() },
        rev: 0,
      };
      await execute([
        {
          type: "node.create",
          level: editing.level,
          parent: editing.parent,
          index: outline.nodes.filter((node) => node.parent === editing.parent).length,
          node: { ...node, ...(editing.level === "chapter" ? fields : {}) },
        },
      ]);
      setSelected([id]);
    }
  };
  const move = (node: OutlineNodeView, delta: number) => {
    const peers =
      outline?.nodes.filter((row) => row.parent === node.parent && row.level === node.level) ?? [];
    const index = peers.findIndex((row) => row.id === node.id);
    if (index + delta < 0 || index + delta >= peers.length) return;
    void execute([
      { type: "node.move", ids: [node.id], parent: node.parent, index: index + delta },
    ]);
  };
  const merge = () => {
    if (!current || selected.length < 2) return;
    if (current.level === "chapter") {
      const id = browserId("pl");
      void execute([
        {
          type: "chapter.merge",
          ids: selected,
          into: {
            id,
            title: current.title,
            planStatus: current.planStatus,
            provenance: { source: "author", at: new Date().toISOString() },
            rev: 0,
          },
        },
      ]);
    } else if (selected.length === 2)
      void execute([
        {
          type: current.level === "act" ? "act.merge" : "volume.merge",
          ids: [selected[0], selected[1]],
        },
      ]);
  };
  return (
    <section data-testid="outline-page">
      <BookSettings work={work} readonly={readonly} />
      <ResourceState loading={data.loading} error={data.error} retry={data.refresh} />
      <div className="zz-plan-toolbar">
        <Button disabled={readonly} onClick={() => void create("volume")} data-testid="add-volume">
          {P["plan.addVolume"]}
        </Button>
        <Button
          disabled={readonly || !current || current.level === "chapter"}
          onClick={() => void create("act")}
        >
          {P["plan.addAct"]}
        </Button>
        <Button
          disabled={readonly || !current || current.level === "volume"}
          onClick={() => void create("chapter")}
          data-testid="add-plan-chapter"
        >
          {P["plan.addChapter"]}
        </Button>
        <Button disabled={readonly || selected.length < 2} onClick={merge}>
          {P["plan.merge"]}
        </Button>
      </div>
      {dirty ? <p role="status">{P["plan.changed"]}</p> : null}
      <p role="status">{message}</p>
      <div className="zz-plan-columns">
        <OutlineTree
          outline={outline}
          selected={selected}
          setSelected={setSelected}
          current={current}
          dirty={dirty}
          readonly={readonly}
          execute={execute}
          move={move}
        />
        <div>
          {editing && (!editing.id || nodeData.value) ? (
            <NodeEditor
              key={editing.id ?? editing.level + editing.parent}
              node={nodeData.value ?? undefined}
              entities={bible?.entities ?? []}
              threads={bible?.threads ?? []}
              level={editing.level}
              readonly={readonly}
              onSave={save}
              onDirty={setDirty}
              onCancel={() => {
                setEditing(null);
                setDirty(false);
              }}
            />
          ) : current ? (
            <div className="zz-plan-card">
              <h3>{current.title}</h3>
              {outline ? (
                <ChapterBinding
                  node={current}
                  outline={outline}
                  readonly={readonly}
                  execute={execute}
                />
              ) : null}
              <p>
                {current.wordCount ?? 0} / {current.wordTargetRollup ?? 0}
              </p>
              <Button
                disabled={readonly}
                onClick={() =>
                  setEditing({ id: current.id, level: current.level, parent: current.parent })
                }
              >
                {P["plan.edit"]}
              </Button>
              <Button
                disabled={readonly}
                onClick={() => {
                  if (current)
                    void askConfirm(P["plan.removeConfirm"]).then((ok) => {
                      if (ok)
                        return execute([
                          { type: "node.delete", id: current.id, expectedRev: current.rev },
                        ]);
                    });
                }}
              >
                {P["plan.delete"]}
              </Button>
              <Button disabled={readonly} onClick={() => setSplit(true)}>
                {P["plan.split"]}
              </Button>
              {current.level === "chapter" && !current.chapterId ? (
                <Button
                  disabled={readonly}
                  onClick={() =>
                    void desktop
                      .workbench("fanqie.chapter.createFromPlan", { work, plan: current.id })
                      .then(() => data.refresh())
                      .catch((error: unknown) => setMessage(String(error)))
                  }
                >
                  {P["plan.createBody"]}
                </Button>
              ) : null}
              <Button disabled={readonly} onClick={() => move(current, -1)}>
                {P["plan.moveUp"]}
              </Button>
              <Button disabled={readonly} onClick={() => move(current, 1)}>
                {P["plan.moveDown"]}
              </Button>
            </div>
          ) : (
            <p>{P["plan.empty"]}</p>
          )}
        </div>
      </div>
      {split && current ? (
        <Dialog title={P["plan.split"]} onClose={() => setSplit(false)}>
          {current.level === "chapter" ? (
            <TextField
              label={P["plan.splitTitles"]}
              value={splitText}
              onChange={setSplitText}
              multiline
            />
          ) : (
            <TextField label={P["plan.splitAt"]} value={splitAt} onChange={setSplitAt} />
          )}
          <Button
            variant="primary"
            onClick={() => {
              if (current.level === "chapter")
                void execute([
                  {
                    type: "chapter.split",
                    id: current.id,
                    parts: splitText
                      .split("\n")
                      .map((title) => title.trim())
                      .filter(Boolean)
                      .map((title) => ({
                        id: browserId("pl"),
                        title,
                        planStatus: "draft",
                        provenance: { source: "author", at: new Date().toISOString() },
                        rev: 0,
                      })),
                  },
                ]);
              else
                void execute([
                  {
                    type: current.level === "act" ? "act.split" : "volume.split",
                    id: current.id,
                    at: Number(splitAt) - 1,
                    newNode: {
                      id: browserId(current.level === "act" ? "act" : "vol"),
                      title: current.title + " II",
                      planStatus: "draft",
                      provenance: { source: "author", at: new Date().toISOString() },
                      rev: 0,
                    },
                  },
                ]);
              setSplit(false);
            }}
          >
            {P["plan.confirm"]}
          </Button>
        </Dialog>
      ) : null}
      {remap ? (
        <Dialog title={P["plan.remapTitle"]} onClose={() => setRemap(null)}>
          <p>{P["plan.remapHint"]}</p>
          {remap.preview.moves.map((move) => (
            <p key={move.id}>
              {move.title}: {move.from} → {move.to}
            </p>
          ))}
          {remap.preview.invalid.length ? <p role="alert">{P["plan.remapInvalid"]}</p> : null}
          <Button
            variant="primary"
            disabled={readonly || !!remap.preview.invalid.length}
            onClick={() => void execute(remap.ops, remap.preview.token)}
          >
            {P["plan.confirm"]}
          </Button>
          <Button onClick={() => setRemap(null)}>{P["plan.cancel"]}</Button>
        </Dialog>
      ) : null}
    </section>
  );
}
