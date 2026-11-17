import type { Entity } from "../bible/types.js";
import { nameKey } from "./extract.js";
export function editDistance(a: string, b: string): number {
  const left = [...a],
    right = [...b];
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const row = [i];
    for (let j = 1; j <= right.length; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(left[i - 1] !== right[j - 1]),
      );
    previous = row;
  }
  return previous[right.length];
}
export function attrCompat(a: Record<string, string> = {}, b: Record<string, string> = {}): number {
  const shared = Object.keys(a).filter((key) => key in b);
  if (!shared.length) return 0.5;
  if (shared.some((key) => /年龄|age|所属|势力|faction/u.test(key) && a[key] !== b[key])) return 0;
  return shared.filter((key) => a[key] === b[key]).length / shared.length;
}
export function matchCandidate(
  name: string,
  attributes: Record<string, string> | undefined,
  entity: Entity,
  coOccurrence: number,
): number {
  const key = nameKey(name),
    other = nameKey(entity.name),
    distance = editDistance(key, other);
  if (
    !(Math.min(key.length, other.length) >= 3 && distance <= 1) &&
    !entity.aliases.some(
      (alias) => nameKey(alias).startsWith(key) || key.startsWith(nameKey(alias)),
    )
  )
    return 0;
  return (
    0.4 * (1 - distance / Math.max(key.length, other.length, 1)) +
    0.3 * attrCompat(attributes, entity.attributes) +
    0.3 * coOccurrence
  );
}
