import { createServer } from "node:http";
export async function fakeModel(scripts = {}, respond) {
  const calls = [],
    queues = structuredClone(scripts);
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      const body = JSON.parse(text || "{}");
      calls.push(body);
      const connection = body.messages?.some((message) => message.content === "请只回答 OK");
      const queue = queues[body.model] || [];
      const next = connection
        ? { text: "OK" }
        : queue.shift() || respond?.(body) || { text: "完成。" };
      if (next.wait) {
        request.on("close", () => response.destroy());
        return;
      }
      if (next.status >= 400) {
        response.writeHead(next.status, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: next.error, code: "invalid_api_key" },
          }),
        );
        return;
      }
      const tool = next.name
        ? {
            id: "call_" + calls.length,
            type: "function",
            function: {
              name: next.name,
              arguments: JSON.stringify(next.input || {}),
            },
          }
        : null;
      if (!body.stream) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            id: "connection",
            object: "chat.completion",
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: next.text || "OK" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 1,
              total_tokens: 11,
            },
          }),
        );
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const send = (delta, finish_reason = null, usage) =>
        response.write(
          "data: " +
            JSON.stringify({
              id: "fixture",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta, finish_reason }],
              ...(usage ? { usage } : {}),
            }) +
            "\n\n",
        );
      send({
        role: "assistant",
        ...(tool ? { tool_calls: [{ index: 0, ...tool }] } : { content: next.text || "完成。" }),
      });
      send({}, next.finish || (tool ? "tool_calls" : "stop"), {
        prompt_tokens: next.usage?.prompt_tokens ?? 30,
        completion_tokens: next.usage?.completion_tokens ?? 8,
        ...(next.usage || {}),
        total_tokens: (next.usage?.prompt_tokens ?? 30) + (next.usage?.completion_tokens ?? 8),
      });
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    calls,
    push: (model, ...items) => {
      (queues[model] ||= []).push(...items);
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
