import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importBundle } from "../support/bundle.mjs";

let cached;
const desktop = () => (cached ??= importBundle("test/support/desktop-entry.ts"));

const TARGET = { mode: "fanqie", path: "/tmp/pi-kernel-work" };

describe("PI 内核适配与会话集成", () => {
  it("resolvePiProviderId 准确映射中文与国际厂商简称到 PI 1.5 内置 providerId", async () => {
    const { resolvePiProviderId } = await desktop();
    assert.equal(resolvePiProviderId("kimi"), "moonshotai-cn");
    assert.equal(resolvePiProviderId("Moonshot"), "moonshotai-cn");
    assert.equal(resolvePiProviderId("qwen"), "qwen-token-plan-cn");
    assert.equal(resolvePiProviderId("DashScope"), "qwen-token-plan-cn");
    assert.equal(resolvePiProviderId("glm"), "zai-coding-cn");
    assert.equal(resolvePiProviderId("zhipu"), "zai-coding-cn");
    assert.equal(resolvePiProviderId("minimax"), "minimax-cn");
    assert.equal(resolvePiProviderId("gemini"), "google");
    assert.equal(resolvePiProviderId("claude"), "anthropic");
    assert.equal(resolvePiProviderId("mimo"), "xiaomi-token-plan-cn");
    assert.equal(resolvePiProviderId("deepseek"), "deepseek");
  });

  it("repairOrphanedToolCalls 为中断后缺失的 toolResult 自动补齐合成错误结果", async () => {
    const { repairOrphanedToolCalls } = await desktop();
    const repaired = repairOrphanedToolCalls([
      { role: "user", id: "u1", text: "读一下第一章", at: 1 },
      {
        role: "assistant",
        id: "a1",
        text: "",
        at: 2,
        toolCalls: [
          { id: "c1", name: "read_chapter", args: { chapter: "ch-001" } },
          { id: "c2", name: "read_bible", args: {} },
        ],
      },
      {
        role: "tool",
        id: "r1",
        callId: "c1",
        name: "read_chapter",
        text: "正文",
        isError: false,
        at: 3,
      },
      { role: "user", id: "u2", text: "继续吧", at: 4 },
    ]);
    assert.equal(repaired.length, 5);
    assert.equal(repaired[2].role, "tool");
    assert.equal(repaired[2].callId, "c1");
    assert.equal(repaired[3].role, "tool");
    assert.equal(repaired[3].callId, "c2");
    assert.equal(repaired[3].isError, true);
    assert.match(repaired[3].text, /run\.stopped/);
    assert.equal(repaired[4].role, "user");
  });

  it("toChatMessages 将多轮助手回复中的思考链合并投影到 ChatMessage.thinking", async () => {
    const { toChatMessages } = await desktop();
    const view = toChatMessages([
      { role: "user", id: "u1", text: "帮我拆一下节奏", at: 1 },
      {
        role: "assistant",
        id: "a1",
        text: "",
        thinking: "先读取第一章结构",
        toolCalls: [{ id: "c1", name: "read_chapter", args: {} }],
        at: 2,
      },
      {
        role: "tool",
        id: "r1",
        callId: "c1",
        name: "read_chapter",
        text: "{}",
        isError: false,
        at: 3,
      },
      {
        role: "assistant",
        id: "a2",
        text: "前 300 字钩子偏弱，建议提前冲突。",
        thinking: "对比开篇三拍，首拍缺少危机触发",
        toolCalls: [],
        at: 4,
      },
    ]);
    assert.equal(view.length, 2);
    assert.equal(view[1].role, "assistant");
    assert.equal(view[1].thinking, "先读取第一章结构\n\n对比开篇三拍，首拍缺少危机触发");
    assert.equal(view[1].text, "前 300 字钩子偏弱，建议提前冲突。");
  });

  it("ModelGateway 隔离同模型不同角色的 thinking/temperature 并透传 sessionId 与 cacheRetention", async () => {
    const { createModelGateway } = await desktop();
    const clock = createFakeClock(1000);
    const seen = [];
    const port = {
      async stream(req) {
        seen.push(req);
        return { text: "ok", usage: { input: 100, cachedInput: 60, output: 20 }, cost: 0 };
      },
    };
    const gw = createModelGateway(
      port,
      {
        globalConcurrency: 2,
        perRunConcurrency: 2,
        roles: {
          writer: { connection: "c1", model: "m1", thinking: "low", temperature: 0.9 },
          reviewer: { connection: "c1", model: "m1", thinking: "high", temperature: 0.2 },
        },
      },
      clock,
    );
    const budget = { reserve: () => ({ settle() {}, release() {} }) };
    await gw.run(
      "writer",
      { system: "s", user: "u" },
      { runId: "run-01", stage: "draft", budget, signal: new AbortController().signal },
    );
    await gw.run(
      "reviewer",
      { system: "s", user: "u" },
      { runId: "run-01", stage: "review", budget, signal: new AbortController().signal },
    );
    assert.equal(seen.length, 2);
    assert.equal(seen[0].thinking, "low");
    assert.equal(seen[0].temperature, 0.9);
    assert.equal(seen[0].sessionId, "run-01");
    assert.equal(seen[0].cacheRetention, "short");
    assert.equal(seen[1].thinking, "high");
    assert.equal(seen[1].temperature, 0.2);
    assert.equal(seen[1].sessionId, "run-01");
    assert.equal(seen[1].cacheRetention, "short");
  });

  it("SessionManager 透传角色参数/缓存会话、流式推送 thinking_delta、并在溢出与限流时自动恢复", async () => {
    const { createSessionManager, createConversationStore, createModelGateway, AppError } =
      await desktop();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zz-pi-session-"));
    try {
      const clock = createFakeClock(1_700_000_000_000);
      const store = createConversationStore(dir, clock);
      const events = [];
      const seenRequests = [];
      let callCount = 0;

      const assistantPort = {
        async turn(req, _signal, on) {
          seenRequests.push(req);
          callCount += 1;
          // 第一次模拟瞬态 429 限流，应由 withRetry 自动退避重试
          if (callCount === 1) {
            throw new AppError("model.rate_limited", "429 rate limited");
          }
          // 压缩摘要调用（tools 为空）
          if (req.tools.length === 0) {
            return {
              text: "已压缩的历史摘要",
              toolCalls: [],
              usage: { input: 50, cachedInput: 0, output: 20 },
              cost: 0,
            };
          }
          // 触发一次中途中溢出，验证自动压缩后重放一次
          if (
            req.messages.some((m) => m.role === "user" && m.text.includes("触发溢出")) &&
            !req.messages.some((m) => m.role === "summary")
          ) {
            throw new AppError("model.context_overflow", "prompt is too long");
          }
          on({ type: "thinking_delta", delta: "推演思路A" });
          on({ type: "thinking_delta", delta: "→推演思路B" });
          on({ type: "text_delta", delta: "最终建议正文" });
          return {
            text: "最终建议正文",
            thinking: "推演思路A→推演思路B",
            toolCalls: [],
            usage: { input: 320, cachedInput: 240, output: 80 },
            cost: 0.01,
          };
        },
      };

      const gw = createModelGateway(
        {
          async stream() {
            return { text: "", usage: { input: 0, cachedInput: 0, output: 0 }, cost: 0 };
          },
        },
        { globalConcurrency: 2, perRunConcurrency: 2, roles: {} },
        clock,
      );

      const manager = createSessionManager({
        clock,
        store,
        gateway: () => gw,
        port: () => assistantPort,
        binding: () => ({
          connection: "conn-1",
          model: "claude-sonnet",
          contextWindow: 128_000,
          maxTokens: 4096,
          thinking: "high",
          temperature: 0.35,
        }),
        tools: () => [
          {
            name: "read_dummy",
            description: "dummy",
            jsonSchema: { type: "object", properties: {} },
            readonly: true,
            parse: (v) => v,
            run: async () => ({ ok: true }),
          },
        ],
        toolCtx: () => ({}),
        context: () => ({ enabled: true, triggerPercent: 85, budget: 0, keepRecentTokens: 10 }),
        preferences: () => "",
        readonly: () => false,
        title: async () => "测试长篇",
        emit: (ev) => events.push(ev),
      });

      // 第一轮：触发 429 后自动重试并流式输出 thinking_delta + 累计 cachedTokens
      const { conversationId } = await manager.send(TARGET, { text: "第一轮提问" });
      await manager.idle(TARGET);

      const thinkingDeltas = events
        .filter((e) => e.kind === "session" && e.event.type === "thinking_delta")
        .map((e) => e.event.delta);
      assert.deepEqual(thinkingDeltas, ["推演思路A", "→推演思路B"]);

      const lastReq = seenRequests[seenRequests.length - 1];
      assert.equal(lastReq.sessionId, conversationId);
      assert.equal(lastReq.cacheRetention, "short");
      assert.equal(lastReq.thinking, "high");
      assert.equal(lastReq.temperature, 0.35);

      const view1 = await manager.view(TARGET);
      assert.equal(view1.task?.cachedTokens, 240);
      const assistantMsg = view1.messages.find((m) => m.role === "assistant");
      assert.equal(assistantMsg?.thinking, "推演思路A→推演思路B");

      // 第二轮：已有 >2 条消息，模拟上下文溢出 → 自动压缩 → 重试成功
      await manager.send(TARGET, { text: "触发溢出测试" });
      await manager.idle(TARGET);

      const compactedEvents = events.filter(
        (e) => e.kind === "session" && e.event.type === "compacted",
      );
      assert.equal(compactedEvents.length, 1);

      const endEvents = events.filter((e) => e.kind === "session" && e.event.type === "end");
      assert.equal(endEvents[endEvents.length - 1].event.reason, "done");

      await manager.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
