import type { Target, Focus } from "../context";
import { buildDeliveryPrompt } from "../../../../packages/fanqie/src/workbench/delivery";
import { ensureStorage, listProjects, resolveWorkDir } from "../../../../packages/fanqie/src/engine/work-store";
import { toutiaoApi } from "../../../../packages/toutiao/src/workbench/api";
import { fanqieApi } from "../../../../packages/fanqie/src/workbench/api";
import { profileRoutes } from "../../../../packages/core/src/profile-api";
import { toutiaoLibrary } from "../../../../packages/toutiao/src/methods";
import { fanqieLibrary } from "../../../../packages/fanqie/src/forge";
import { buildToutiaoDelivery } from "../../../../packages/toutiao/src/workbench/data";
import { API, type RouteContext } from "../../../../packages/workbench/src/server";
import { selectTarget } from "./targets";
import type { Runtime } from "./runtime";

async function performRequest(
  state: Runtime,
  operation: string,
  options: { method?: string; query?: Record<string, unknown>; body?: any } = {},
) {
  const selected = state.target;
  if (!selected) throw new Error("请先选择创作目录");
  if (state.maintenance && options.method === "POST")
    throw new Error("正在恢复作品，请等待完成后再修改");
  const url = new URL(API + operation, "app://writer");
  for (const [k, v] of Object.entries(options.query || {}))
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const body = options.body || {};
  const projects = await listProjects();
  // 新建方案的 base 表示方法底稿（default / original），不是作品目录。
  const base = operation.endsWith("/profiles/create")
    ? undefined
    : body.base || body.project || options.query?.base;
  const project = projects.find((p: any) =>
    base ? p.id === base || p.base === base : p.base === selected.root,
  );
  if (base && !project) throw new Error("项目未登记，请重新选择创作目录");
  const root = body.root || options.query?.root || project?.base || selected.root;
  const mode = operation.startsWith("/toutiao") ? "toutiao" : "fanqie";
  const operationTarget: Target = {
    mode,
    root: String(root),
    ...(body.work || options.query?.work
      ? { work: String(body.work || options.query?.work) }
      : {}),
  };
  if (operation.endsWith("/deliver") || operation === "/agent/deliver") {
    await selectTarget(state, operationTarget);
    state.emit({ selection: state.target });
    const prompt =
      mode === "toutiao"
        ? await buildToutiaoDelivery(operationTarget.root, body, "")
        : await buildDeliveryPrompt(
            await resolveWorkDir(
              await ensureStorage(null, {
                ...state.writerConfig.fanqie,
                storageRoot: operationTarget.root,
                ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
              }),
              body.work,
            ),
            body,
            "",
          );
    const focus: Focus =
      mode === "toutiao"
        ? { article: body.id, source: "article" }
        : {
            chapter: "chapterId" in prompt ? prompt.chapterId : undefined,
            source: "chapter",
          };
    await state.sessions.send(operationTarget, prompt.text, {
      ...focus,
      intent: body.action === "review" ? "review" : "write",
    });
    return { status: 200, data: { ok: true, text: prompt.text } };
  }
  if (operation.endsWith("/capabilities"))
    return {
      status: 200,
      data: {
        ok: true,
        quick: true,
        deep: false,
        deliver: !!state.model.writer.apiKey,
        reason: state.model.writer.apiKey ? undefined : "请先保存模型连接",
      },
    };
  const cfg = {
    ...state.writerConfig[mode],
    storageRoot: operationTarget.root,
    python: state.pythonPath(),
    ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
  };
  const modes = [
    toutiaoApi(cfg, () => !!state.model.writer.apiKey),
    fanqieApi(cfg),
    profileRoutes(API + "/toutiao", toutiaoLibrary, () => state.writerConfig.toutiao?.profile),
    profileRoutes(API + "/fanqie", fanqieLibrary, () => state.writerConfig.fanqie?.profile),
  ];
  let response: { status: number; data: any } = {
    status: 404,
    data: { ok: false, error: "未知操作" },
  };
  const ctx: RouteContext = {
    url,
    method: options.method || "GET",
    path: url.pathname,
    json(status, data) {
      response = { status, data };
    },
    async body() {
      return body;
    },
    async readBody() {
      return { parsed: body };
    },
  };
  for (const handler of modes) if (await handler.handle(ctx)) break;
  if (operation === "/toutiao/articles") {
    response.data.currentRoot = selected.root;
    response.data.deliverReason = state.model.writer.apiKey
      ? undefined
      : "请先保存模型连接";
  }
  const writes =
    /\/(candidate\/accept|chapter\/(review|finalize)|revision\/acknowledge|diagnostics\/stage|toutiao\/adopt|profiles\/(use|create|save|reset|rename|delete))$/.test(
      operation,
    );
  if (ctx.method === "POST" && response.status < 400 && writes) {
    try {
      const notifyTarget =
        !operationTarget.work &&
        mode === selected.mode &&
        operationTarget.root === selected.root
          ? selected
          : operationTarget;
      await state.sessions.notify(notifyTarget, {
        operation,
        article: body.id,
        chapter: body.chapter || body.chapterId || response.data.chapterId,
        candidate: body.candidate || response.data.candidateId,
        revision: response.data.revision || response.data.rev,
        status: response.data.status,
        profile: typeof body.profile === "string" ? body.profile : undefined,
      });
    } catch (error) {
      state.emit({
        target: operationTarget,
        error: "操作已完成，但对话通知失败：" + String(error),
      });
    }
    state.emit({ refresh: true });
  }
  return response;
}

export async function request(
  state: Runtime,
  operation: string,
  options: any = {},
): Promise<{ status: number; data: any }> {
  const id = options.body?.requestId;
  if (!id || !operation.endsWith("/deliver"))
    return performRequest(state, operation, options);
  const key = JSON.stringify([
    operation,
    id,
    options.body.root,
    options.body.base,
    options.body.work,
  ]);
  const existing = state.deliveries.get(key);
  if (existing) return existing;
  const pending = performRequest(state, operation, options);
  state.deliveries.set(key, pending);
  if (state.deliveries.size > 100)
    state.deliveries.delete(state.deliveries.keys().next().value!);
  try {
    return await pending;
  } catch (error) {
    state.deliveries.delete(key);
    throw error;
  }
}
