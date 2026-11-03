import type { WriterMessage, WriterResult } from "./renderer-contracts";
import { asRecord, parseTarget, parseFocus, parseText } from "./main/ipc/validate";
export function writerResult(message: WriterMessage): WriterResult | undefined {
  const details = message.details;
  if (!details || typeof details !== "object" || !("writerResult" in details)) return undefined;
  const raw = asRecord(details.writerResult, "写作回执");
  return {
    kind: parseText(raw.kind),
    target: parseTarget(raw.target),
    focus: parseFocus(raw.focus),
    summary: parseText(raw.summary),
    ...(raw.draftLabel === undefined ? {} : { draftLabel: parseText(raw.draftLabel) }),
    ...(typeof raw.failed === "boolean" ? { failed: raw.failed } : {}),
  };
}
