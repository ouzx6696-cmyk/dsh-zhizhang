import { createServer } from "node:http";

/**
 * OpenAI 兼容的假模型服务（chat/completions，流式与非流式）。
 * respond(body, lastUser) 返回 { text } / { tool: { name, input } } / { status, error } / { hold: true }。
 * 只供 E2E 使用：不出网、不计费。
 */
export async function fakeModel(respond) {
  const calls = [];
  const holds = new Set();
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const body = JSON.parse(raw || "{}");
      calls.push(body);
      const users = (body.messages ?? []).filter((m) => m.role === "user");
      const last = users.at(-1);
      const lastUser = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((p) => p.text ?? "").join("");
      const next = lastUser.includes("请只回答 OK") ? { text: "OK" } : (respond(body, lastUser) ?? { text: "完成。" });
      if (next.status) {
        response.writeHead(next.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: next.error ?? "error" } }));
        return;
      }
      const usage = { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 };
      if (!body.stream) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            id: "fake",
            object: "chat.completion",
            created: 1,
            model: body.model,
            choices: [{ index: 0, message: { role: "assistant", content: next.text ?? "" }, finish_reason: "stop" }],
            usage,
          }),
        );
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const send = (delta, finish_reason = null, withUsage) =>
        response.write(
          "data: " +
            JSON.stringify({
              id: "fake",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta, finish_reason }],
              ...(withUsage ? { usage } : {}),
            }) +
            "\n\n",
        );
      if (next.hold) {
        // 先吐一段再挂住，供“停止”旅程使用；连接关闭即清理。
        send({ role: "assistant", content: next.text ?? "思考中" });
        const beat = setInterval(() => response.write(": keep-alive\n\n"), 50);
        holds.add(beat);
        response.on("close", () => {
          clearInterval(beat);
          holds.delete(beat);
        });
        return;
      }
      if (next.tool) {
        send({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${calls.length}`,
              type: "function",
              function: { name: next.tool.name, arguments: JSON.stringify(next.tool.input ?? {}) },
            },
          ],
        });
        send({}, "tool_calls", true);
      } else {
        send({ role: "assistant", content: next.text ?? "" });
        send({}, "stop", true);
      }
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    calls,
    close: () =>
      new Promise((resolve) => {
        for (const beat of holds) clearInterval(beat);
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
