import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readSource } from "../../apps/desktop/out-test/network.mjs";

test("T123 来源按头或 meta 解码 GBK，展开实体并拒绝未知字符集", async (t) => {
  let header, bytes;
  t.mock.method(http, "get", (_url, _options, callback) => {
    const request = new EventEmitter();
    request.destroy = (error) => request.emit("error", error);
    queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = 200;
      response.headers = { "content-type": header };
      callback(response);
      response.end(bytes);
    });
    return request;
  });
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  for (const meta of [false, true]) {
    header = meta ? "text/html" : "text/html; charset=gbk";
    bytes = Buffer.concat([
      Buffer.from(meta ? '<meta charset="gb2312"><p>' : "<p>"),
      gbk,
      Buffer.from("&ldquo;&#20013;&rdquo;&#x1f600;</p>"),
    ]);
    assert.equal((await readSource("http://8.8.8.8/test")).text, "中文“中”😀");
  }
  header = "text/html; charset=unknown-charset";
  bytes = Buffer.from("text");
  await assert.rejects(readSource("http://8.8.8.8/test"), /encoding|charset/i);
});
