/** 写作台方法方案命令：查询、创建、切换、修改及删除。 */
import { str } from "../../core/src/parse.js";
import { WriterError } from "../../core/src/tool.js";
import { commandPolicy, sendError, type CommandContext } from "./commands.js";
import {
  createProfile,
  deleteProfile,
  findProfile,
  listProfiles,
  profileDetail,
  readMethod,
  renameProfile,
  resetMethod,
  saveMethod,
  activateProfile,
  type MethodLibrary,
} from "../../core/src/profiles.js";

export function profileRoutes(base: string, lib: MethodLibrary, pinned?: () => string | undefined) {
  async function handle(ctx: CommandContext): Promise<boolean> {
    const policy = commandPolicy(ctx.command);
    if (policy?.handler !== "profile" || base !== `/${policy.mode}`) return false;
    const sub = policy.profileAction;
    if (ctx.kind !== policy.kind) {
      ctx.reply({ ok: false, code: "invalid_command", error: `操作类型不匹配：${ctx.command}` });
      return true;
    }
    const pin = pinned?.();
    try {
      if (sub === "")
        return (ctx.reply({ ok: true, mode: lib.mode, ...(await listProfiles(lib, pin)) }), true);
      if (sub === "/detail")
        return (
          ctx.reply({
            ok: true,
            ...(await profileDetail(lib, str(ctx.input.profile) || "default", pin)),
          }),
          true
        );
      if (sub === "/method") {
        const profile = str(ctx.input.profile) || "default",
          id = str(ctx.input.id) || "";
        if (!id)
          return (ctx.reply({ ok: false, code: "bad_request", error: "须指明方法 id" }), true);
        const m = await readMethod(lib, profile, id, pin);
        let baseText: string | undefined;
        if (m.from === "user") {
          const meta = await findProfile(lib.mode, profile);
          baseText = await readMethod(lib, meta.base ?? "default", m.id, pin)
            .then((b) => b.text)
            .catch((error) => {
              if (error instanceof WriterError && error.code === "NOT_FOUND") return undefined;
              throw error;
            });
        }
        return (ctx.reply({ ok: true, method: m, base_text: baseText }), true);
      }
      const body = ctx.input;
      if (!body) return true;
      if (sub === "/use")
        ctx.reply({
          ok: true,
          profile: await activateProfile(lib.mode, str(body.profile), pin),
        });
      else if (sub === "/create") {
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
      } else if (sub === "/save")
        ctx.reply({
          ok: true,
          ...(await saveMethod(lib, str(body.profile), str(body.id), body.text)),
        });
      else if (sub === "/reset")
        ctx.reply({ ok: true, ...(await resetMethod(lib, str(body.profile), str(body.id))) });
      else if (sub === "/rename")
        ctx.reply({
          ok: true,
          profile: await renameProfile(
            lib.mode,
            str(body.profile),
            str(body.name),
            typeof body.note === "string" ? body.note : undefined,
          ),
        });
      else {
        if (body.confirm !== true)
          ctx.reply({ ok: false, code: "confirmation_required", error: "删除方案须明确确认" });
        else ctx.reply({ ok: true, ...(await deleteProfile(lib.mode, str(body.profile))) });
      }
    } catch (err) {
      sendError(ctx, err);
    }
    return true;
  }
  return { handle };
}
