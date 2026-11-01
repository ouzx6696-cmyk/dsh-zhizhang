/** The only Pi SDK import boundary, including its accepted-prompt hook. */
export {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
export type {
  AgentSession,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  ModelRuntime,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ModelConnection } from "../models";
/** Keep cancellation attached through context preparation and SDK prompt startup. */
export async function promptWithSignal(
  session: AgentSession,
  prepare: () => Promise<string>,
  signal?: AbortSignal,
) {
  const abort = () => {
    void session.abort();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const text = await prepare();
    signal?.throwIfAborted();
    await session.prompt(text, {
      expandPromptTemplates: false,
      // prompt awaits input/auth before marking a run active. Reapply an abort
      // received in that gap once the run exists, before its first request.
      preflightResult: () => {
        if (signal?.aborted) abort();
      },
    });
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
export async function runtimeModel(
  settings: ModelConnection,
  authPath: string,
  role: string,
) {
  const runtime = await ModelRuntime.create({
    authPath,
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.registerProvider("writer-" + role, {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    api: settings.api,
    models: [
      {
        id: settings.model,
        name: settings.model,
        reasoning: settings.reasoning,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: settings.contextWindow,
        maxTokens: settings.maxTokens,
      },
    ],
  });
  const model = runtime.getModel("writer-" + role, settings.model);
  if (!model) throw new Error("模型配置未生效");
  return { runtime, model };
}
export async function promptAccepted(
  session: AgentSession,
  text: string,
  onError: (error: unknown) => void,
) {
  await new Promise<void>((resolve, reject) => {
    let accepted = false;
    void session
      .prompt(text, {
        streamingBehavior: "followUp",
        expandPromptTemplates: false,
        preflightResult: () => {
          accepted = true;
          resolve();
        },
      })
      .then(
        () => resolve(),
        (error) => (accepted ? onError(error) : reject(error)),
      );
  });
}
export async function testConnection(
  settings: ModelConnection,
  authPath: string,
) {
  if (!settings.apiKey) throw new Error("请先填写 API Key");
  const start = Date.now(),
    { runtime, model } = await runtimeModel(settings, authPath, "connection");
  const answer = await runtime.completeSimple(
    model,
    {
      messages: [
        { role: "user", content: "请只回答 OK", timestamp: Date.now() },
      ],
    },
    { maxTokens: 32 },
  );
  if (answer.stopReason === "error")
    throw new Error(answer.errorMessage || "模型连接失败");
  return { latency: Date.now() - start, model: settings.model };
}
