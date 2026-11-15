/** 写作台方法方案命令：查询、创建、切换、修改及删除。 */
import { isMissingFileError } from "../../core/src/errors.js";
import { str } from "../../core/src/parse.js";
import { WriterError } from "../../core/src/tool.js";
import {
  activateProfile,
  createProfile,
  deleteProfile,
  findProfile,
  listProfiles,
  profileDetail,
  readMethod,
  renameProfile,
  resetMethod,
  saveMethod,
  type MethodLibrary,
} from "../../core/src/profiles.js";

export interface ProfileCommandContext {
  command: string;
  kind: "read" | "write";
  input: Record<string, unknown>;
  reply(result: unknown): void;
}

const PROFILE_READS = new Set(["", "/detail", "/method"]);
const PROFILE_WRITES = new Set(["/use", "/create", "/save", "/reset", "/rename", "/delete"]);

function sendProfileError(ctx: Pick<ProfileCommandContext, "reply">, error: unknown): void {
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

export function profileRoutes(base: string, lib: MethodLibrary, pinned?: () => string | undefined) {
  async function handle(ctx: ProfileCommandContext): Promise<boolean> {
    const prefix = `${base}/profiles`;
    if (!ctx.command.startsWith(prefix)) return false;
    const sub = ctx.command.slice(prefix.length);
    const expectedKind = PROFILE_READS.has(sub)
      ? "read"
      : PROFILE_WRITES.has(sub)
        ? "write"
        : null;
    if (!expectedKind) return false;
    if (ctx.kind !== expectedKind) {
      ctx.reply({ ok: false, code: "invalid_command", error: `操作类型不匹配：${ctx.command}` });
      return true;
    }
    const pin = pinned?.();
    try {
      if (sub === "") {
        ctx.reply({ ok: true, mode: lib.mode, ...(await listProfiles(lib, pin)) });
        return true;
      }
      if (sub === "/detail") {
        ctx.reply({
          ok: true,
          ...(await profileDetail(lib, str(ctx.input.profile) || "default", pin)),
        });
        return true;
      }
      if (sub === "/method") {
        const profile = str(ctx.input.profile) || "default";
        const id = str(ctx.input.id) || "";
        if (!id) {
          ctx.reply({ ok: false, code: "bad_request", error: "须指明方法 id" });
          return true;
        }
        const m = await readMethod(lib, profile, id, pin);
        let baseText: string | undefined;
        if (m.from === "user") {
          const meta = await findProfile(lib.mode, profile);
          baseText = await readMethod(lib, meta.base ?? "default", m.id, pin)
            .then((b) => b.text)
            .catch((error: unknown) => {
              if (error instanceof WriterError && error.code === "NOT_FOUND") return undefined;
              throw error;
            });
        }
        ctx.reply({ ok: true, method: m, base_text: baseText });
        return true;
      }
      const body = ctx.input;
      if (!body) return true;
      if (sub === "/use") {
        ctx.reply({
          ok: true,
          profile: await activateProfile(lib.mode, str(body.profile), pin),
        });
      } else if (sub === "/create") {
        const files = Array.isArray(body.files)
          ? body.files.map((f) => ({
              id: str((f as Record<string, unknown>)?.id),
              text: String((f as Record<string, unknown>)?.text ?? ""),
            }))
          : [];
        ctx.reply({
          ok: true,
          profile: await createProfile(lib, {
            name: str(body.name) || undefined,
            base: str(body.base) || undefined,
            note: str(body.note) || undefined,
            files,
          }),
        });
      } else if (sub === "/save") {
        ctx.reply({
          ok: true,
          ...(await saveMethod(lib, str(body.profile), str(body.id), body.text)),
        });
      } else if (sub === "/reset") {
        ctx.reply({ ok: true, ...(await resetMethod(lib, str(body.profile), str(body.id))) });
      } else if (sub === "/rename") {
        ctx.reply({
          ok: true,
          profile: await renameProfile(
            lib.mode,
            str(body.profile),
            str(body.name),
            typeof body.note === "string" ? body.note : undefined,
          ),
        });
      } else if (body.confirm !== true) {
        ctx.reply({ ok: false, code: "confirmation_required", error: "删除方案须明确确认" });
      } else {
        ctx.reply({ ok: true, ...(await deleteProfile(lib.mode, str(body.profile))) });
      }
    } catch (err) {
      sendProfileError(ctx, err);
    }
    return true;
  }
  return { handle };
}
