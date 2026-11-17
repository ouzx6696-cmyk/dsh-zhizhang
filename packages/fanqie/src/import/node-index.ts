import { nodesOf, type Outline } from "../outline/store.js";

export function nextNodeIndex(
  outline: Outline,
  level: "volume" | "act" | "chapter",
  parent: string | undefined,
  order: number | undefined,
  createdSiblings: Map<string, number>,
): { key: string; index: number } {
  const key = level === "volume" ? "volume:root" : `${level}:${parent ?? ""}`;
  const inserted = createdSiblings.get(key) ?? 0;
  const existingParent = parent
    ? nodesOf(outline).find(({ node }) => node.id === parent)?.node
    : undefined;
  const siblingCount =
    level === "volume"
      ? outline.book.volumeOrder.length
      : level === "act" && existingParent && "acts" in existingParent
        ? existingParent.acts.length
        : level === "chapter" && existingParent && "chapters" in existingParent
          ? existingParent.chapters.length
          : 0;
  const requested = Math.max(0, (order ?? 1) - 1);
  return {
    key,
    index: Math.min(Math.max(requested, inserted), siblingCount + inserted),
  };
}

export function removeCreatedSibling(
  createdSiblings: Map<string, number>,
  level: "volume" | "act" | "chapter",
  parent: string | undefined,
): void {
  const key = level === "volume" ? "volume:root" : `${level}:${parent ?? ""}`;
  const inserted = createdSiblings.get(key) ?? 0;
  if (inserted > 0) createdSiblings.set(key, inserted - 1);
}
