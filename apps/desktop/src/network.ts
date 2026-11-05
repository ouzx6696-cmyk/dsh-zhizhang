export type SearchProvider = "exa" | "tavily";
export type SearchMode = "lite" | "auto";
import { VERSION } from "../../../packages/core/src/version";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
export function publicAddress(address: string) {
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
export async function readSource(
  input: string,
  signal?: AbortSignal,
): Promise<{ url: string; date: string; text: string }> {
  let url = new URL(input);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new Error("资料链接须为不含登录信息的 HTTP(S) 地址");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
      throw new Error("资料读取不支持本机、内网或保留地址");
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
            "User-Agent": `WriterAgent/${VERSION}`,
          },
          lookup: ((_host: unknown, options: any, callback: any) =>
            options?.all
              ? callback(null, [chosen])
              : callback(null, chosen.address, chosen.family)) as any,
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
            reject(new Error(`资料网站返回 HTTP ${status}`));
            return;
          }
          if (!/text\/|application\/xhtml\+xml/.test(response.headers["content-type"] || "")) {
            response.destroy();
            reject(new Error("该链接不是可读取的文本页面"));
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          response.on("data", (chunk) => {
            length += chunk.length;
            if (length > 2 * 1024 * 1024) {
              request.destroy(new Error("资料超过 2 MB，请提供较短页面或作者摘录"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      request.on("timeout", () => request.destroy(new Error("资料网站连接超时，请稍后重试")));
      request.on("error", reject);
    });
    if (result.location) {
      url = new URL(result.location);
      continue;
    }
    const text = (result.text || "")
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    return {
      url: url.href,
      date: new Date().toISOString(),
      text: text.slice(0, 80000) + (text.length > 80000 ? "\n（文本已截断）" : ""),
    };
  }
  throw new Error("资料网站重定向次数过多");
}
export async function searchSources(
  query: string,
  key: string,
  signal?: AbortSignal,
  provider: SearchProvider = "exa",
  mode: SearchMode = "lite",
) {
  if (!key) throw new Error("未配置搜索服务；请提供资料链接或作者素材");
  const response = await fetch(
    provider === "exa" ? "https://api.exa.ai/search" : "https://api.tavily.com/search",
    {
      method: "POST",
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]),
      headers: {
        "Content-Type": "application/json",
        ...(provider === "exa" ? { "x-api-key": key } : {}),
      },
      body: JSON.stringify(
        provider === "exa"
          ? { query, type: mode, numResults: 3 }
          : { api_key: key, query, max_results: 3, include_raw_content: false },
      ),
    },
  );
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? "请检查搜索 API Key 和权限"
        : response.status === 429
          ? "请检查搜索额度或稍后重试"
          : provider === "exa" && mode === "lite" && response.status === 400
            ? "轻量模式可能不支持当前请求，可显式选择标准模式"
            : "请稍后重试或检查服务状态";
    throw new Error(`${provider} 搜索返回 HTTP ${response.status}；${hint}`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results))
    throw new Error("搜索服务响应格式无效");
  const results = data.results.slice(0, 3).map((item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("title" in item) ||
      typeof item.title !== "string" ||
      !("url" in item) ||
      typeof item.url !== "string"
    )
      throw new Error("搜索结果缺少标题或网址");
    const url = new URL(item.url);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("搜索返回了非网页来源");
    return {
      title: item.title,
      url: url.href,
      date:
        "publishedDate" in item && typeof item.publishedDate === "string"
          ? item.publishedDate
          : "published_date" in item && typeof item.published_date === "string"
            ? item.published_date
            : null,
      retrievedAt: new Date().toISOString(),
      summary:
        "content" in item && typeof item.content === "string" ? item.content.slice(0, 1000) : "",
    };
  });
  const requestId =
    "requestId" in data && typeof data.requestId === "string" ? data.requestId : undefined;
  const costs = "costDollars" in data ? data.costDollars : undefined;
  const cost =
    costs &&
    typeof costs === "object" &&
    "total" in costs &&
    typeof costs.total === "number" &&
    Number.isFinite(costs.total)
      ? costs.total
      : undefined;
  return { results, requestId, cost };
}
