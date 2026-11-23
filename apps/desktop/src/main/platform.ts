/**
 * 宿主平台抽象（HostPlatform）：把桌面宿主（Electron）与浏览器预览宿主（Web）的原生能力
 * 收敛到单一接口，令服务组合根与 RPC 分发器完全不依赖 electron。
 */
import type { OpenedText } from "../shared/views.js";
import type { SecretCipher } from "./services/config.js";

export interface HostPlatform {
  readonly kind: "electron" | "web";
  readonly packaged: boolean;
  readonly platform: string;
  readonly electronVersion?: string;
  readonly cipher: SecretCipher;
  pickDirectory(title: string): Promise<string | null>;
  pickSave(defaultName: string, extension: string): Promise<string | null>;
  openTextFile(options: { title?: string; extensions?: string[] }): Promise<OpenedText | null>;
  copyText(text: string): void;
  openExternal(url: string): Promise<void>;
  openPath(resolvedPath: string): Promise<void>;
  runBackup(script: string, args: string[], signal: AbortSignal): Promise<void>;
}

/** 文本文件解码：优先严格 UTF-8（去 BOM），失败回落 GBK。 */
export function decodeTextBuffer(bytes: Buffer): {
  content: string;
  encoding: OpenedText["encoding"];
} {
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""),
      encoding: "utf-8",
    };
  } catch {
    return { content: new TextDecoder("gbk").decode(bytes), encoding: "gbk" };
  }
}
