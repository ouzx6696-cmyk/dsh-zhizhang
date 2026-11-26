import { systemClock, type Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { APP_VERSION } from "@zhizhang/core/version";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;

function publicAddress(address: string): boolean {
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

/** 校验接口地址仅解析到公网 IP，阻止云端或共享部署访问本机、内网或云元数据地址。 */
export async function assertPublicEndpoint(baseUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AppError("input.invalid", "模型接口地址格式无效", { field: "baseUrl" });
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new AppError("input.invalid", "模型接口须为不含登录信息的 HTTP(S) 地址", {
      field: "baseUrl",
    });
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((item) => !publicAddress(item.address))) {
    throw new AppError("input.invalid", "当前预览环境禁止连接本机、内网或保留地址的模型端点", {
      field: "baseUrl",
    });
  }
}

function normalizeCharset(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower === "gb2312" || lower === "gbk" || lower === "gb_2312") return "gb18030";
  return lower;
}

export function decodeSourceBytes(bytes: Buffer, contentType: string): string {
  const head = bytes.subarray(0, 2048).toString("latin1");
  const declared =
    /charset\s*=\s*["']?([^\s;"'>]+)/i.exec(contentType)?.[1] ??
    /<meta\b[^>]*charset\s*=\s*["']?([^\s;"'>]+)/i.exec(head)?.[1];
  const candidates = [...(declared ? [normalizeCharset(declared)] : []), "utf-8", "gb18030"];
  const seen = new Set<string>();
  for (const label of candidates) {
    if (seen.has(label)) continue;
    seen.add(label);
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes);
    } catch {
      // 尝试下一个编码候选
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
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

function decodeEntities(value: string): string {
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

export function extractReadableText(html: string): string {
  const stripped = html
    .replace(/<(script|style|noscript|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(stripped)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function decodedStream(response: http.IncomingMessage): Readable {
  const enc = (response.headers["content-encoding"] || "").trim().toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return response.pipe(zlib.createGunzip());
  if (enc === "deflate") return response.pipe(zlib.createInflate());
  if (enc === "br") return response.pipe(zlib.createBrotliDecompress());
  return response;
}

export async function readSource(
  input: string,
  signal?: AbortSignal,
  clock: Clock = systemClock,
): Promise<{ url: string; date: string; text: string }> {
  let url = new URL(input);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      throw new AppError("input.invalid", "资料链接须为不含登录信息的 HTTP(S) 地址", {
        field: "url",
      });
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) {
      throw new AppError("input.invalid", "资料读取不支持本机、内网或保留地址", { field: "url" });
    }
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
            "Accept-Encoding": "gzip, deflate, br, identity",
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
            resolve({ location: new URL(location, url).href });
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
          const stream = decodedStream(response);
          const chunks: Buffer[] = [];
          let length = 0;
          stream.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > MAX_RESPONSE_BYTES) {
              const err = new AppError("input.invalid", "资料超过 2 MB，请提供较短页面或作者摘录", {
                field: "url",
              });
              stream.destroy(err);
              request.destroy(err);
              return;
            }
            chunks.push(chunk);
          });
          stream.on("error", reject);
          stream.on("end", () => {
            try {
              resolve({
                text: decodeSourceBytes(
                  Buffer.concat(chunks),
                  response.headers["content-type"] || "",
                ),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("timeout", () =>
        request.destroy(new AppError("network.proxy", "资料网站连接超时，请稍后重试")),
      );
      request.on("error", reject);
    });
    if (result.location) {
      url = new URL(result.location);
      continue;
    }
    const text = extractReadableText(result.text || "");
    return {
      url: url.href,
      date: clock.iso(),
      text:
        text.slice(0, MAX_TEXT_CHARS) + (text.length > MAX_TEXT_CHARS ? "\n（文本已截断）" : ""),
    };
  }
  throw new AppError("input.invalid", "资料网站重定向次数过多", { field: "url" });
}
