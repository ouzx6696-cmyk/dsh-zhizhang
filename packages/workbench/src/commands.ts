import { isMissingFileError } from "../../core/src/errors.js";

export interface CommandContext {
  command: string;
  kind: "read" | "write";
  input: Record<string, unknown>;
  reply(result: unknown): void;
}

export interface WorkbenchCommands {
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

const PROFILE_READS = ["", "/detail", "/method"] as const;
const PROFILE_WRITES = ["/use", "/create", "/save", "/reset", "/rename", "/delete"] as const;

export type CommandPolicy = {
  mode: "fanqie" | "toutiao";
  handler: "fanqie" | "toutiao" | "profile" | "deliver" | "capabilities";
  kind: "read" | "write" | "both";
  writes: "none" | "work" | "profile";
  notify?: boolean;
  profileAction?: string;
};

const fanqieRead: CommandPolicy = {
  mode: "fanqie",
  handler: "fanqie",
  kind: "read",
  writes: "none",
};
const fanqieWrite: CommandPolicy = {
  mode: "fanqie",
  handler: "fanqie",
  kind: "write",
  writes: "work",
  notify: true,
};
const toutiaoRead: CommandPolicy = {
  mode: "toutiao",
  handler: "toutiao",
  kind: "read",
  writes: "none",
};
const toutiaoWrite: CommandPolicy = {
  mode: "toutiao",
  handler: "toutiao",
  kind: "write",
  writes: "work",
  notify: true,
};

const policies: Record<string, CommandPolicy> = {
  [COMMANDS.projects]: fanqieRead,
  [COMMANDS.snapshot]: fanqieRead,
  [COMMANDS.chapter]: fanqieRead,
  [COMMANDS.candidate]: fanqieRead,
  [COMMANDS.saveChapter]: fanqieWrite,
  [COMMANDS.reviewChapter]: fanqieWrite,
  [COMMANDS.finalizeChapter]: fanqieWrite,
  [COMMANDS.stageRevision]: fanqieWrite,
  [COMMANDS.accept]: fanqieWrite,
  [COMMANDS.acknowledge]: fanqieWrite,
  [COMMANDS.diagnose]: { ...fanqieRead, kind: "write" },
  [COMMANDS.unifyPrepare]: { ...fanqieRead, kind: "both" },
  [COMMANDS.capabilities]: { ...fanqieRead, handler: "capabilities" },
  [COMMANDS.deliver]: { ...fanqieWrite, handler: "deliver", notify: false },
  [COMMANDS.articles]: toutiaoRead,
  [COMMANDS.article]: toutiaoRead,
  [COMMANDS.adoptArticle]: toutiaoWrite,
  [COMMANDS.saveArticle]: toutiaoWrite,
  [COMMANDS.deliverArticle]: { ...toutiaoWrite, handler: "deliver", notify: false },
};
for (const mode of ["fanqie", "toutiao"] as const) {
  for (const action of PROFILE_READS)
    policies[`/${mode}/profiles${action}`] = {
      mode,
      handler: "profile",
      kind: "read",
      writes: "none",
      profileAction: action,
    };
  for (const action of PROFILE_WRITES)
    policies[`/${mode}/profiles${action}`] = {
      mode,
      handler: "profile",
      kind: "write",
      writes: "profile",
      notify: true,
      profileAction: action,
    };
}

export function commandPolicy(command: string): CommandPolicy | undefined {
  return policies[command];
}

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
