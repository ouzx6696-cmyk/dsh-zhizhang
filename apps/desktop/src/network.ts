import { AppError } from "@zhizhang/core/errors";
import { APP_VERSION } from "@zhizhang/core/version";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
function publicAddress(address: string) {
  const ip = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  return (
    isIP(ip) === 6 &&
    /^[23]/.test(ip) &&
    !ip.startsWith("2001:db8:") &&
    !ip.startsWith("2001:0:") &&
    !ip.startsWith("2002:")
  );
}
function decodeSource(bytes: Buffer, contentType: string) {
  const head = bytes.subarray(0, 2048).toString("latin1");
  const charset =
    /charset\s*=\s*["']?([^\s;"'>]+)/i.exec(contentType)?.[1] ??
    /<meta\b[^>]*charset\s*=\s*["']?([^\s;"'>]+)/i.exec(head)?.[1] ??
    "utf-8";
  return new TextDecoder(charset, { fatal: true }).decode(bytes);
}
const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
};
function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const point =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}
export async function readSource(
  input: string,
  signal?: AbortSignal,
): Promise<{ url: string; date: string; text: string }> {
  let url = new URL(input);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new AppError("input.invalid", "资料链接须为不含登录信息的 HTTP(S) 地址", { field: "url" });
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
      throw new AppError("input.invalid", "资料读取不支持本机、内网或保留地址", { field: "url" });
    const chosen = addresses[0];
    const result = await new Promise<{ location?: string; text?: string }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).get(
        url,
        {
          signal,
          timeout: 20000,
          agent: false,
          headers: {
            Accept: "text/html,text/plain,application/xhtml+xml",
            "Accept-Encoding": "identity",
            "User-Agent": `Zhizhang/${APP_VERSION}`,
          },
          lookup: (
            _host: string,
            options: LookupOptions,
            callback: (
              err: NodeJS.ErrnoException | null,
              address: string | LookupAddress[],
              family?: number,
            ) => void,
          ) =>
            options?.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family),
        },
        (response) => {
          const status = response.statusCode || 0;
          const location = status >= 300 && status < 400 ? response.headers.location : undefined;
          if (location !== undefined) {
            response.destroy();
            resolve({
              location: new URL(location, url).href,
            });
            return;
          }
          if (status < 200 || status >= 300) {
            response.destroy();
            reject(new AppError("input.not_found", `资料网站返回 HTTP ${status}`, { status }));
            return;
          }
          if (!/text\/|application\/xhtml\+xml/.test(response.headers["content-type"] || "")) {
            response.destroy();
            reject(new AppError("input.invalid", "该链接不是可读取的文本页面", { field: "url" }));
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          response.on("data", (chunk) => {
            length += chunk.length;
            if (length > 2 * 1024 * 1024) {
              request.destroy(new AppError("input.invalid", "资料超过 2 MB，请提供较短页面或作者摘录", { field: "url" }));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              resolve({
                text: decodeSource(Buffer.concat(chunks), response.headers["content-type"] || ""),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new AppError("network.proxy", "资料网站连接超时，请稍后重试")));
      request.on("error", reject);
    });
    if (result.location) {
      url = new URL(result.location);
      continue;
    }
    const text = decodeEntities(
      (result.text || "")
        .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
        .replace(/<[^>]*>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim();
    return {
      url: url.href,
      date: new Date().toISOString(),
      text: text.slice(0, 80000) + (text.length > 80000 ? "\n（文本已截断）" : ""),
    };
  }
  throw new AppError("input.invalid", "资料网站重定向次数过多", { field: "url" });
}
