/**
 * Web 预览可选口令鉴权：
 * - 未配置口令（ZHIZHANG_WEB_PASSCODE 为空）时自动放行，保持本地零门槛；
 * - 配置口令后采用常量时间摘要校验，仅在服务端内存签发短期 Bearer 会话令牌。
 */
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 64;

function sha256Digest(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function extractToken(req: IncomingMessage, url: URL): string {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return url.searchParams.get("token")?.trim() ?? "";
}

export interface WebAuth {
  readonly required: boolean;
  verifyPasscode(candidate: string): string | null;
  isAuthorized(req: IncomingMessage, url: URL): boolean;
}

export function createWebAuth(passcode?: string): WebAuth {
  const secret = (passcode ?? process.env.ZHIZHANG_WEB_PASSCODE ?? "").trim();
  const required = secret.length > 0;
  const expectedDigest = required ? sha256Digest(secret) : Buffer.alloc(0);
  const sessions = new Map<string, number>();

  function prune(now: number): void {
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
    while (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  }

  return {
    required,
    verifyPasscode(candidate: string): string | null {
      if (!required) return "";
      if (typeof candidate !== "string" || candidate.length === 0) return null;
      const actualDigest = sha256Digest(candidate);
      if (actualDigest.length !== expectedDigest.length) return null;
      if (!crypto.timingSafeEqual(actualDigest, expectedDigest)) return null;
      const now = Date.now();
      prune(now);
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, now + SESSION_TTL_MS);
      return token;
    },
    isAuthorized(req: IncomingMessage, url: URL): boolean {
      if (!required) return true;
      const token = extractToken(req, url);
      if (!token) return false;
      const expiresAt = sessions.get(token);
      if (expiresAt === undefined) return false;
      const now = Date.now();
      if (expiresAt <= now) {
        sessions.delete(token);
        return false;
      }
      return true;
    },
  };
}
