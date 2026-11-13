import { isMissingFileError } from "../../core/src/errors.js";

export interface CommandContext {
  command: string;
  kind: "read" | "write";
  input: Record<string, unknown>;
  reply(result: unknown): void;
}

export interface WorkbenchCommands {
  commands: string[];
  handle(ctx: CommandContext): Promise<boolean>;
}

export const COMMANDS = {
  projects: "/projects",
  snapshot: "/snapshot",
  chapter: "/chapter",
  saveChapter: "/chapter/save",
  reviewChapter: "/chapter/review",
  finalizeChapter: "/chapter/finalize",
  candidate: "/candidate",
  diagnose: "/diagnostics/scan",
  stageRevision: "/diagnostics/stage",
  accept: "/candidate/accept",
  acknowledge: "/revision/acknowledge",
  unifyPrepare: "/unify/prepare",
  capabilities: "/diagnostics/capabilities",
  deliver: "/agent/deliver",
  articles: "/toutiao/articles",
  article: "/toutiao/article",
  adoptArticle: "/toutiao/adopt",
  saveArticle: "/toutiao/draft",
  deliverArticle: "/toutiao/agent/deliver",
} as const;

export function sendError(ctx: Pick<CommandContext, "reply">, error: unknown) {
  const domain = error instanceof Error && ["WriterError", "NovelError"].includes(error.name);
  const missing = isMissingFileError(error);
  const code = missing
    ? "NOT_FOUND"
    : domain && "code" in error && typeof error.code === "string"
      ? error.code
      : "failed";
  ctx.reply({
    ok: false,
    code,
    uncertain: code === "failed",
    error: error instanceof Error ? error.message : String(error),
  });
}
