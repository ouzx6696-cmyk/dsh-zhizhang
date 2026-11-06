import type { Target, Focus } from "../context";
import { buildDeliveryPrompt } from "../../../../packages/fanqie/src/workbench/delivery";
import { listProjects } from "../../../../packages/fanqie/src/engine/storage/projects";
import { toutiaoApi } from "../../../../packages/toutiao/src/workbench/api";
import { fanqieApi } from "../../../../packages/fanqie/src/workbench/api";
import { profileRoutes } from "../../../../packages/workbench/src/profile-api";
import { toutiaoLibrary } from "../../../../packages/toutiao/src/methods";
import { fanqieLibrary } from "../../../../packages/fanqie/src/forge";
import { buildToutiaoDelivery } from "../../../../packages/toutiao/src/workbench/data";
import { API, ROUTES, type RouteContext } from "../../../../packages/workbench/src/routes";
import { selectTarget } from "./targets";
import { resolveFanqieWork } from "./storage";
import type { Runtime } from "./runtime";
import type { RequestOptions, RequestResult } from "./ipc/contract";
import { asRecord } from "./ipc/validate";

function textField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value !== undefined && typeof value !== "string") throw new Error(`参数无效：${key}`);
  return value;
}
/** 回执字段宽松读取：字符串原样，其余当缺失（AuthorAction 的可选字段）。 */
function responseText(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}
/** 回执修订标识：字符串或数字原样透传（与历史宽松读取一致），其余当缺失。 */
function responseId(data: Record<string, unknown>, key: string): string | number | undefined {
  const value = data[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}
async function resolveOperationTarget(state: Runtime, operation: string, options: RequestOptions) {
  const selected = state.target;
  if (!selected) throw new Error("请先选择创作目录");
  if (state.maintenance && options.method === "POST")
    throw new Error("正在恢复作品，请等待完成后再修改");
  const url = new URL(API + operation, "app://writer");
  for (const [key, value] of Object.entries(options.query ?? {}))
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  const body = options.body === undefined ? {} : asRecord(options.body, "请求内容");
  const base = operation.endsWith("/profiles/create")
    ? undefined
    : textField(body, "base") || textField(body, "project") || options.query?.base;
  const project = (await listProjects()).find((row) =>
    base ? row.id === base || row.base === base : row.base === selected.root,
  );
  if (base && !project) throw new Error("项目未登记，请重新选择创作目录");
  const mode = operation.startsWith("/toutiao") ? "toutiao" : "fanqie";
  const work = textField(body, "work") || options.query?.work;
  const target: Target = {
    mode,
    root: textField(body, "root") || String(options.query?.root || project?.base || selected.root),
    ...(work ? { work: String(work) } : {}),
  };
  const config = {
    ...state.writerConfig[mode],
    storageRoot: target.root,
    python: state.pythonPath(),
    ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
  };
  return { selected, url, body, target, config };
}
type Operation = Awaited<ReturnType<typeof resolveOperationTarget>>;
async function deliver(state: Runtime, context: Operation): Promise<RequestResult> {
  const { target, body } = context;
  await selectTarget(state, target);
  state.emit({ selection: state.target });
  const action = textField(body, "action");
  if (!action) throw new Error("参数无效：action");
  if (
    target.mode === "fanqie" &&
    (action === "draw-opening" || action === "draw-chapter-end") &&
    state.writerConfig.fanqie?.draw?.enabled !== true
  )
    throw new Error("抽卡未开启：先在配置里把 fanqie.draw.enabled 设为 true");
  const note = textField(body, "note");
  const prompt =
    target.mode === "toutiao"
      ? await buildToutiaoDelivery(target.root, { action, note, id: textField(body, "id") }, "")
      : await buildDeliveryPrompt(
          await resolveFanqieWork(state.writerConfig, target),
          { action, note, chapter: textField(body, "chapter") },
          "",
        );
  const focus: Focus =
    target.mode === "toutiao"
      ? { article: textField(body, "id"), source: "article" }
      : { chapter: "chapterId" in prompt ? prompt.chapterId : undefined, source: "chapter" };
  await state.sessions.send(target, prompt.text, {
    ...focus,
    intent:
      action === "review"
        ? "review"
        : action === "revise"
          ? "revise"
          : action === "new"
            ? "plan"
            : "write",
  });
  return { status: 200, data: { ok: true, text: prompt.text } };
}
async function route(
  state: Runtime,
  context: Operation,
  options: RequestOptions,
): Promise<RequestResult> {
  const { config, url, body, selected } = context;
  const modes = [
    toutiaoApi(config, () => !!state.model.writer.apiKey),
    fanqieApi(config),
    profileRoutes(API + "/toutiao", toutiaoLibrary, () => state.writerConfig.toutiao?.profile),
    profileRoutes(API + "/fanqie", fanqieLibrary, () => state.writerConfig.fanqie?.profile),
  ];
  let response: RequestResult = { status: 404, data: { ok: false, error: "未知操作" } };
  const ctx: RouteContext = {
    url,
    method: options.method ?? "GET",
    path: url.pathname,
    json(status, data) {
      response = { status, data };
    },
    async body() {
      return body;
    },
  };
  for (const handler of modes) if (await handler.handle(ctx)) break;
  if (url.pathname === API + "/toutiao/articles") {
    const data = asRecord(response.data, "响应内容");
    data.currentRoot = selected.root;
    data.deliverReason = state.model.writer.apiKey ? undefined : "请先保存模型连接";
  }
  return response;
}
async function notifyWrite(
  state: Runtime,
  operation: string,
  context: Operation,
  response: RequestResult,
) {
  if (
    !/\/(candidate\/accept|chapter\/(review|finalize|save)|revision\/acknowledge|diagnostics\/stage|toutiao\/(adopt|draft)|profiles\/(use|create|save|reset|rename|delete))$/.test(
      operation,
    )
  )
    return;
  const { target, selected, body } = context;
  try {
    const bound =
      !target.work && target.mode === selected.mode && target.root === selected.root
        ? selected
        : target;
    const data = asRecord(response.data, "回执内容");
    await state.sessions.notify(bound, {
      operation,
      article: textField(body, "id"),
      chapter:
        textField(body, "chapter") ||
        textField(body, "chapterId") ||
        responseText(data, "chapterId"),
      candidate: textField(body, "candidate") || responseText(data, "candidateId"),
      revision: responseId(data, "revision") || responseId(data, "rev"),
      status: responseText(data, "status"),
      profile: textField(body, "profile"),
    });
  } catch (error) {
    state.emit({ target, error: "操作已完成，但对话通知失败：" + String(error) });
  }
  state.emit({ refresh: true });
}
async function performRequest(state: Runtime, operation: string, options: RequestOptions = {}) {
  const context = await resolveOperationTarget(state, operation, options);
  if (operation === ROUTES.deliver || operation === ROUTES.deliverArticle)
    return deliver(state, context);
  if (operation === ROUTES.capabilities)
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
  const response = await route(state, context, options);
  if (options.method === "POST" && response.status < 400)
    await notifyWrite(state, operation, context, response);
  return response;
}
export async function request(
  state: Runtime,
  operation: string,
  options: RequestOptions = {},
): Promise<RequestResult> {
  const body = options.body === undefined ? {} : asRecord(options.body, "请求内容"),
    id = body.requestId;
  if (!id || !(operation === ROUTES.deliver || operation === ROUTES.deliverArticle))
    return performRequest(state, operation, options);
  const key = JSON.stringify([operation, id, body.root, body.base, body.work]);
  const existing = state.deliveries.get(key);
  if (existing) return existing;
  const pending = performRequest(state, operation, options);
  state.deliveries.set(key, pending);
  if (state.deliveries.size > 100) {
    const oldest = state.deliveries.keys().next().value;
    if (oldest !== undefined) state.deliveries.delete(oldest);
  }
  try {
    return await pending;
  } catch (error) {
    state.deliveries.delete(key);
    throw error;
  }
}
