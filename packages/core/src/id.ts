import { randomBytes } from "node:crypto";
import { AppError } from "./errors/app-error.js";

/** 前缀 + 8 位 Crockford base32；测试可注入确定性随机源。 */
export interface IdSource {
  next(prefix: string): string;
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BYTES = 5; // 40 bit → 8 字符，无余位
const CHARS = 8;

/**
 * 创建 id 生成器。默认使用 node:crypto.randomBytes(5)；
 * 注入的随机源必须返回 5 字节，便于测试断言固定序列。
 */
export function createIdSource(rand: () => Uint8Array = () => randomBytes(BYTES)): IdSource {
  return {
    next(prefix: string): string {
      if (prefix.length === 0) {
        throw new AppError("internal", "IdSource: 前缀不能为空");
      }
      const bytes = rand();
      if (bytes.length !== BYTES) {
        throw new AppError("internal", `IdSource: 随机源必须返回 ${BYTES} 字节`);
      }
      let bits = 0n;
      for (const byte of bytes) {
        bits = (bits << 8n) | BigInt(byte);
      }
      let suffix = "";
      for (let index = CHARS - 1; index >= 0; index -= 1) {
        suffix += ALPHABET[Number((bits >> BigInt(index * 5)) & 31n)];
      }
      return `${prefix}-${suffix}`;
    },
  };
}
