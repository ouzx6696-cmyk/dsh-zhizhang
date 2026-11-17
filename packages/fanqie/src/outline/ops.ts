import { dropUndefined } from "@zhizhang/core/schema";
import { AppError } from "@zhizhang/core/errors";
import type { Act, ChapterPlan, OutlineOp, VolumeFile } from "./types.js";
import { copyOutline, nodesOf, validateOutline, type Outline } from "./store.js";

export function applyOutlineOps(input: Outline, ops: OutlineOp[]): Outline {
  const outline = copyOutline(input);
  const find = (id: string) => {
    const ref = nodesOf(outline).find(({ node }) => node.id === id);
    if (!ref) throw new AppError("input.not_found", "大纲节点不存在", { id });
    return ref;
  };
  const act = (id?: string): Act => {
    const node = id ? find(id).node : undefined;
    if (!node || !("chapters" in node)) throw new AppError("input.invalid", "父节点须为幕");
    return node;
  };
  const volume = (id?: string): VolumeFile => {
    const node = id ? find(id).node : undefined;
    if (!node || !("acts" in node)) throw new AppError("input.invalid", "父节点须为卷");
    return node;
  };
  const remove = (id: string) => {
    const ref = find(id);
    if (ref.level === "volume") {
      outline.book.volumeOrder = outline.book.volumeOrder.filter((x) => x !== id);
      outline.volumes.delete(id);
    } else if (ref.level === "act") {
      const parent = volume(ref.parent);
      parent.acts = parent.acts.filter((x) => x.id !== id);
      parent.rev++;
    } else {
      const parent = act(ref.parent);
      parent.chapters = parent.chapters.filter((x) => x.id !== id);
      parent.rev++;
    }
    return ref;
  };
  const insert = (
    level: "volume" | "act" | "chapter",
    node: VolumeFile | Act | ChapterPlan,
    parent: string | undefined,
    index: number,
  ) => {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new AppError("input.invalid", "插入位置必须为非负整数", { index });
    if (level === "volume") {
      if (!("acts" in node)) throw new AppError("input.invalid", "卷节点缺少幕列表");
      if (index > outline.book.volumeOrder.length)
        throw new AppError("input.invalid", "卷插入位置超出范围", { index });
      outline.volumes.set(node.id, node);
      outline.book.volumeOrder.splice(index, 0, node.id);
    } else if (level === "act") {
      if (!("chapters" in node)) throw new AppError("input.invalid", "幕节点缺少章纲列表");
      const target = volume(parent);
      if (index > target.acts.length)
        throw new AppError("input.invalid", "幕插入位置超出范围", { index });
      target.acts.splice(index, 0, node);
      target.rev++;
    } else {
      if ("chapters" in node || "acts" in node) throw new AppError("input.invalid", "非法章纲节点");
      const target = act(parent);
      if (index > target.chapters.length)
        throw new AppError("input.invalid", "章纲插入位置超出范围", { index });
      target.chapters.splice(index, 0, node);
      target.rev++;
    }
  };
  for (const op of ops) {
    if (op.type === "book.update") {
      if (outline.book.rev !== op.expectedRev)
        throw new AppError("storage.conflict", "大纲版本已变化");
      Object.assign(outline.book, dropUndefined(op.patch));
      outline.book.rev++;
    } else if (op.type === "node.create") {
      if (nodesOf(outline).some(({ node }) => node.id === op.node.id))
        throw new AppError("input.invalid", "节点标识重复");
      const node: VolumeFile | Act | ChapterPlan =
        op.level === "volume"
          ? { ...op.node, format: "zhizhang/1.3", acts: [] }
          : op.level === "act"
            ? { ...op.node, chapters: [] }
            : { ...op.node };
      insert(op.level, dropUndefined(node), op.parent, op.index);
    } else if (op.type === "node.update" || op.type === "node.delete") {
      const ref = find(op.id);
      if (ref.node.rev !== op.expectedRev)
        throw new AppError("storage.conflict", "节点版本已变化", { id: op.id });
      if (op.type === "node.delete") remove(op.id);
      else {
        Object.assign(ref.node, dropUndefined(op.patch));
        ref.node.rev++;
      }
    } else if (op.type === "node.move") {
      if (!op.ids.length || new Set(op.ids).size !== op.ids.length)
        throw new AppError("input.invalid", "移动节点列表不能为空且不能重复");
      const refs = op.ids.map(find);
      if (refs.some((ref) => ref.level !== refs[0]?.level))
        throw new AppError("input.invalid", "不能混合移动不同层级");
      if (refs[0]?.level === "volume" && op.parent)
        throw new AppError("input.invalid", "卷只能放在根层级");
      for (const id of op.ids) remove(id);
      refs.forEach((ref, i) => insert(ref.level, ref.node, op.parent, op.index + i));
    } else if (op.type === "chapter.bind" || op.type === "chapter.unbind") {
      const ref = find(op.plan);
      if (ref.level !== "chapter" || "acts" in ref.node || "chapters" in ref.node)
        throw new AppError("input.invalid", "绑定目标须为章纲");
      if (op.type === "chapter.bind") ref.node.chapterId = op.chapterId;
      else delete ref.node.chapterId;
      ref.node.rev++;
    } else if (op.type === "chapter.split") {
      const ref = find(op.id),
        parent = act(ref.parent),
        index = parent.chapters.findIndex((node) => node.id === op.id);
      if (ref.level !== "chapter" || op.parts.length < 2)
        throw new AppError("input.invalid", "拆分章纲至少需要两个部分");
      const bound = "chapterId" in ref.node ? ref.node.chapterId : undefined;
      if (op.parts.slice(1).some((part) => part.chapterId))
        throw new AppError("input.invalid", "拆分只允许首章绑定正文");
      parent.chapters.splice(
        index,
        1,
        ...op.parts.map((part, i) => ({
          ...part,
          ...(i === 0 && bound ? { chapterId: bound } : {}),
        })),
      );
      parent.rev++;
    } else if (op.type === "chapter.merge") {
      if (op.ids.length < 2 || new Set(op.ids).size !== op.ids.length)
        throw new AppError("input.invalid", "合并章纲至少需要两个不同节点");
      const refs = op.ids.map(find);
      if (refs.some((ref) => ref.level !== "chapter" || ref.parent !== refs[0]?.parent))
        throw new AppError("input.invalid", "合并章纲须属于同一幕");
      const bound = refs.flatMap(({ node }) =>
        "chapterId" in node && node.chapterId ? [node.chapterId] : [],
      );
      if (bound.length > 1)
        throw new AppError("input.invalid", "多个正文不能合并", { rule: "merge_multi_bound" });
      if (nodesOf(outline).some(({ node }) => node.id === op.into.id && !op.ids.includes(node.id)))
        throw new AppError("input.invalid", "合并结果标识已被使用", { id: op.into.id });
      const parent = act(refs[0]?.parent),
        index = parent.chapters.findIndex((node) => node.id === op.ids[0]);
      for (const id of op.ids) remove(id);
      insert(
        "chapter",
        { ...op.into, ...(bound[0] ? { chapterId: bound[0] } : {}) },
        parent.id,
        index,
      );
    } else if (op.type === "act.split" || op.type === "volume.split") {
      const ref = find(op.id);
      if (op.type === "act.split") {
        const old = act(op.id),
          parent = volume(ref.parent),
          index = parent.acts.findIndex((n) => n.id === op.id);
        if (ref.level !== "act" || op.at < 1 || op.at >= old.chapters.length)
          throw new AppError("input.invalid", "幕拆分位置必须位于现有章纲之间");
        insert(
          "act",
          { ...op.newNode, chapters: old.chapters.splice(op.at) },
          parent.id,
          index + 1,
        );
        old.rev++;
      } else {
        const old = volume(op.id),
          index = outline.book.volumeOrder.indexOf(op.id);
        if (ref.level !== "volume" || op.at < 1 || op.at >= old.acts.length)
          throw new AppError("input.invalid", "卷拆分位置必须位于现有幕之间");
        insert(
          "volume",
          { ...op.newNode, format: "zhizhang/1.3", acts: old.acts.splice(op.at) },
          undefined,
          index + 1,
        );
        old.rev++;
      }
    } else if ("ids" in op) {
      if (op.ids[0] === op.ids[1]) throw new AppError("input.invalid", "不能将节点与自身合并");
      const left = find(op.ids[0]),
        right = find(op.ids[1]);
      if (op.type === "act.merge") {
        if (left.level !== "act" || right.level !== "act" || left.parent !== right.parent)
          throw new AppError("input.invalid", "只能合并同卷的幕");
        const target = act(op.ids[0]);
        target.chapters.push(...act(op.ids[1]).chapters);
        target.rev++;
      } else {
        if (left.level !== "volume" || right.level !== "volume")
          throw new AppError("input.invalid", "只能合并卷节点");
        const target = volume(op.ids[0]);
        target.acts.push(...volume(op.ids[1]).acts);
        target.rev++;
      }
      remove(op.ids[1]);
    }
  }
  validateOutline(outline);
  return outline;
}
