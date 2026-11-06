/** Author confirmation rules pin the current chapter revision before approval. */
import { WriterError } from "../../core/src/tool.js";
import { readChapter as readStoredChapter } from "./engine/storage/chapters.js";
import type { GateRule } from "../../core/src/gates.js";
import type { FanqieConfig } from "./config.js";
import { bodyFingerprint, editorPassProblem } from "./review.js";
import { openWork } from "./works.js";
import type { Role } from "./tools.js";

export function fanqieGateRules(config: FanqieConfig, role: Role): GateRule[] {
  if (role === "editor") return [];
  return [
    {
      id: "fanqie.finalize_requires_author",
      tool: "fanqie_chapter_save",
      locked: true,
      description: "定稿须作者确认",
      async check(args, exec) {
        if (args.status !== "final") return undefined;
        await pinChapter(args, exec, config);
        return {
          kind: "ask",
          reason: `把「${String(args.chapter ?? args.id ?? "本章")}」定稿（final）需要作者确认。审读通过不自动获得定稿权。`,
        };
      },
    },
    {
      id: "fanqie.force_requires_author",
      tool: "fanqie_*",
      locked: true,
      description: "force 覆盖定稿须作者确认",
      async check(args, exec) {
        if (args.force !== true) return undefined;
        if (exec.name === "fanqie_chapter_save") await pinChapter(args, exec, config);
        return {
          kind: "ask",
          reason: `${exec.name} 带 force=true，会覆盖已定稿正文（降回草稿、需重新审读），需要作者确认。`,
        };
      },
    },
  ];
}

async function pinChapter(
  args: Record<string, unknown>,
  exec: import("../../core/src/tool.js").ToolExecution,
  config: FanqieConfig,
) {
  const w = await openWork(
    exec,
    typeof args.work === "string" ? args.work : undefined,
    typeof args.working_dir === "string" ? args.working_dir : undefined,
  );
  const ch = await readStoredChapter(w.dir, String(args.chapter ?? ""));
  // Validate before asking, then bind approval to the revision the author saw.
  if (args.status === "final" && config.requireEditorPass) {
    const problem = await editorPassProblem(
      w.dir,
      ch,
      bodyFingerprint(typeof args.content === "string" ? args.content : ch.body),
    );
    if (problem) throw new WriterError("GATE_DENIED", problem);
  }
  args.work = w.key;
  args.expected_revision ??= ch.revision;
}
