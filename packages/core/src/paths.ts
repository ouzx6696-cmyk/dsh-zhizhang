import path from "node:path";
import { homedir } from "node:os";
let root: string | undefined;
export function setStateRoot(value: string) {
  root = path.resolve(value);
}
export function stateRoot() {
  return root ?? (process.env.DSH_HOME?.trim() || path.join(homedir(), ".dsh"));
}
