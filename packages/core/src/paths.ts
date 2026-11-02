import path from "node:path";
import { homedir } from "node:os";
let root: string | undefined;
export function setStateRoot(value: string) {
  root = path.resolve(value);
}
export function stateRoot() {
  return root ?? (process.env.WRITER_STATE_ROOT?.trim() || path.join(homedir(), ".writer-agent"));
}
