import type { Target, Focus } from "../context";
import { buildDeliveryPrompt } from "../../../../packages/fanqie/src/workbench/delivery";
import { listProjects } from "../../../../packages/fanqie/src/engine/storage/projects";
import { listKnownRoots } from "../../../../packages/toutiao/src/env";
import { physicalRoot, rootIdentity } from "../../../../packages/core/src/identity";
import {
  isToutiaoCommand,
  runToutiaoCommand,
} from "../../../../packages/toutiao/src/workbench/api";
import { fanqieApi } from "../../../../packages/fanqie/src/workbench/api";
import { profileRoutes } from "../../../../packages/workbench/src/profile-api";
import { toutiaoLibrary } from "../../../../packages/toutiao/src/methods";
import { fanqieLibrary } from "../../../../packages/fanqie/src/forge";
import { buildToutiaoDelivery } from "../../../../packages/toutiao/src/workbench/data";
import {
  COMMANDS,
  commandPolicy,
  sendError,
  type CommandPolicy,
  type CommandContext,
} from "../../../../packages/workbench/src/commands";
import {
  workspaceAccess,
  workspaceReadOnlyError,
} from "../../../../packages/core/src/workspace-lock";
import { lockRoot, selectTarget } from "./targets";
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
async function resolveOperationTarget(
  state: Runtime,
  policy: CommandPolicy,
  options: RequestOptions,
) {
  const selected = state.target;
  if (!selected) throw new Error("请先选择创作目录");
  if (state.maintenance && options.kind === "write")
    throw new Error("正在恢复作品，请等待完成后再修改");
  const input = options.input === undefined ? {} : asRecord(options.input, "操作内容");
  const base =
    policy.profileAction === "/create"
      ? undefined
      : textField(input, "base") || textField(input, "project");
  const requested = textField(input, "root");
  const projects = await listProjects();
  const project = projects.find((row) =>
    base
      ? row.id === base || rootIdentity(row.base) === rootIdentity(base)
      : rootIdentity(row.base) === rootIdentity(requested || selected.root),
  );
  if (base && !project) throw new Error("项目未登记，请重新选择创作目录");
  const mode = policy.mode;
  const root = physicalRoot(requested || project?.base || selected.root);
  if (requested) {
    const roots = mode === "toutiao" ? await listKnownRoots() : projects.map((row) => row.base);
    if (!roots.concat(selected.root).some((value) => rootIdentity(value) === rootIdentity(root)))
      throw new Error("目录未登记，请先选择创作目录");
    if (base && project && rootIdentity(root) !== rootIdentity(project.base))
      throw new Error("目录与项目不一致，请重新选择创作目录");
  }
  const work =
    textField(input, "work") ||
    (mode === selected.mode && rootIdentity(root) === rootIdentity(selected.root)
      ? selected.work
      : undefined);
  const target: Target = {
    mode,
    root,
    ...(work ? { work: String(work) } : {}),
  };
  const config = {
    ...state.writerConfig[mode],
    storageRoot: target.root,
    python: state.pythonPath(),
    ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
  };
  return { selected, input, target, config };
}
type Operation = Awaited<ReturnType<typeof resolveOperationTarget>>;

async function deliver(state: Runtime, context: Operation): Promise<RequestResult> {
  const { target, input: body } = context;
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
  return { data: { ok: true, text: prompt.text } };
}
async function dispatchCommand(
  state: Runtime,
  context: Operation,
  operation: string,
  options: RequestOptions,
  policy: CommandPolicy,
): Promise<RequestResult> {
  const { config, input } = context;
  const handler =
    policy.handler === "profile"
      ? profileRoutes(
          `/${policy.mode}`,
          policy.mode === "toutiao" ? toutiaoLibrary : fanqieLibrary,
          () => state.writerConfig[policy.mode]?.profile,
        )
      : fanqieApi(config);
  let response: RequestResult = { data: { ok: false, code: "NOT_FOUND", error: "未知操作" } };
  const ctx: CommandContext = {
    command: operation,
    kind: options.kind ?? "read",
    input,
    reply(data) {
      response = { data };
    },
  };
  await handler.handle(ctx);
  return response;
}
async function notifyWrite(
  state: Runtime,
  operation: string,
  context: Operation,
  response: RequestResult,
) {
  const { target, selected, input: body } = context;
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
/** 主进程入口自己拒绝的请求，与路由失败同一形状（code + error），界面按同一提示显示。 */
function refused(error: unknown): RequestResult {
  let result: RequestResult = { data: {} };
  sendError({ reply: (data) => (result = { data }) }, error);
  return result;
}
async function performRequest(state: Runtime, operation: string, options: RequestOptions = {}) {
  const policy = commandPolicy(operation);
  if (!policy) return { data: { ok: false, code: "NOT_FOUND", error: "未知操作" } };
  const kind = options.kind ?? "read";
  if (policy.kind !== "both" && policy.kind !== kind)
    return { data: { ok: false, code: "invalid_command", error: `操作类型不匹配：${operation}` } };
  const context = await resolveOperationTarget(state, policy, options);
  if (policy.writes === "work") {
    const access = await workspaceAccess(await lockRoot(state, context.target));
    if (access.readOnly) return refused(workspaceReadOnlyError(access.owner));
  }
  if (policy.handler === "deliver") return deliver(state, context);
  if (policy.handler === "capabilities")
    return {
      data: {
        ok: true,
        quick: true,
        deep: false,
        deliver: !!state.model.writer.apiKey,
        deliverReason: state.model.writer.apiKey ? undefined : "请先保存模型连接",
      },
    };
  let response: RequestResult;
  if (isToutiaoCommand(operation)) {
    response = await runToutiaoCommand(
      operation,
      context.input,
      context.config,
      !!state.model.writer.apiKey,
    );
    if (operation === COMMANDS.articles) {
      const data = asRecord(response.data, "响应内容");
      data.currentRoot = context.selected.root;
    }
  } else response = await dispatchCommand(state, context, operation, options, policy);
  if (policy.notify && asRecord(response.data, "回执内容").ok !== false)
    await notifyWrite(state, operation, context, response);
  return response;
}
export async function request(
  state: Runtime,
  operation: string,
  options: RequestOptions = {},
): Promise<RequestResult> {
  const body = options.input === undefined ? {} : asRecord(options.input, "操作内容"),
    id = body.requestId;
  if (!id || !(operation === COMMANDS.deliver || operation === COMMANDS.deliverArticle))
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
