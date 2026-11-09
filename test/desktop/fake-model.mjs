import { createServer } from "node:http";
export async function fakeModel(scripts = {}, respond) {
  const calls = [],
    streamed = [],
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
      // Streams that stall after the response headers: "after-first" sends one text chunk (with
      // usage when given) and goes silent; "keepalive" never sends content, only SSE comments.
      if (next.hang) {
        if (next.hang === "after-first")
          send({ role: "assistant", content: next.text || "半" }, null, next.usage);
        else send({ role: "assistant" });
        const beat = setInterval(() => response.write(": keep-alive\n\n"), 20);
        response.on("close", () => clearInterval(beat));
        streamed.push(body.model);
        return;
      }
      // A reasoning model that thinks for a while: one reasoning delta per tick, then the answer.
      if (next.thinking) {
        send({ role: "assistant" });
        let sent = 0;
        const beat = setInterval(() => {
          if (sent++ < next.thinking.count) {
            send({ reasoning_content: "想" });
            return;
          }
          clearInterval(beat);
          send({ content: next.text || "完成。" });
          send({}, "stop", { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 });
          response.end("data: [DONE]\n\n");
        }, next.thinking.everyMs);
        response.on("close", () => clearInterval(beat));
        streamed.push(body.model);
        return;
      }
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
    /** Models whose hanging or thinking stream has sent its first chunk. */
    streamed,
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
