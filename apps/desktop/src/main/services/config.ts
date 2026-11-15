/**
 * ConfigService + 密钥：settings.json（非机密）与 secrets.bin（系统密钥库加密的 API Key）。
 * 不依赖 electron：密钥加解密由组合根注入（safeStorage），测试可注入假实现。
 */
import path from "node:path";
import { AppError, classify, isAppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists } from "@zhizhang/core/fs";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import {
  DEFAULT_SETTINGS,
  mergeSettingsPatch,
  parseSettings,
  type AppSettings,
  type ModelConnection,
  type ModelsInput,
  type PublicSettings,
  type SettingsPatch,
} from "../../shared/settings.js";
import type { SettingsIssue } from "../../shared/views.js";

export interface SecretCipher {
  available(): boolean;
  encrypt(text: string): string;
  decrypt(text: string): string;
}

export interface ConfigService {
  settings(): AppSettings;
  issue(): SettingsIssue | undefined;
  publicSettings(): PublicSettings;
  apiKey(connectionId: string): string;
  connection(connectionId: string): ModelConnection;
  savePatch(patch: SettingsPatch): Promise<PublicSettings>;
  saveModels(input: ModelsInput): Promise<PublicSettings>;
  setWorkspaceRoot(root: string): Promise<void>;
  reset(): Promise<PublicSettings>;
  onChange(listener: (settings: AppSettings) => void): void;
}

function issueOf(err: unknown): SettingsIssue {
  const appErr = classify(err);
  const dataPath = appErr.data?.path;
  return {
    code: appErr.code,
    message: appErr.message,
    ...(typeof dataPath === "string" ? { path: dataPath } : {}),
  };
}

export async function createConfigService(opts: {
  stateRoot: string;
  cipher: SecretCipher;
}): Promise<ConfigService> {
  const settingsFile = path.join(opts.stateRoot, "settings.json");
  const secretsFile = path.join(opts.stateRoot, "secrets.bin");
  const listeners: Array<(settings: AppSettings) => void> = [];
  let current: AppSettings = DEFAULT_SETTINGS;
  let issue: SettingsIssue | undefined;
  const keys = new Map<string, string>();

  const raw = await readTextIfExists(settingsFile);
  if (raw !== undefined) {
    try {
      current = parseSettings(JSON.parse(raw));
    } catch (err) {
      issue =
        err instanceof SyntaxError
          ? {
              code: "input.invalid",
              message: `settings.json 不是合法 JSON：${err.message}`,
              path: "$settings",
            }
          : issueOf(err);
    }
  }

  if (opts.cipher.available()) {
    const secretsRaw = await readTextIfExists(secretsFile);
    if (secretsRaw !== undefined) {
      try {
        const data: unknown = JSON.parse(secretsRaw);
        if (
          typeof data !== "object" ||
          data === null ||
          !("format" in data) ||
          data.format !== FORMAT_VERSION
        ) {
          throw new AppError("storage.format_unsupported", "secrets.bin 格式不受支持");
        }
        const stored =
          "keys" in data && typeof data.keys === "object" && data.keys !== null ? data.keys : {};
        for (const [id, value] of Object.entries(stored)) {
          if (typeof value === "string") keys.set(id, opts.cipher.decrypt(value));
        }
      } catch (err) {
        issue ??= isAppError(err)
          ? issueOf(err)
          : {
              code: "storage.format_unsupported",
              message: "密钥文件无法解密，需要重新填写 API Key",
            };
      }
    }
  }

  async function persistSettings(next: AppSettings): Promise<void> {
    current = next;
    await atomicWrite(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
    for (const listener of listeners) listener(next);
  }

  async function persistSecrets(): Promise<void> {
    if (!opts.cipher.available()) return;
    const out: Record<string, string> = {};
    for (const [id, key] of keys) out[id] = opts.cipher.encrypt(key);
    await atomicWrite(secretsFile, JSON.stringify({ format: FORMAT_VERSION, keys: out }, null, 2));
  }

  function assertEditable(): void {
    if (issue) {
      throw new AppError("input.invalid", "设置文件有误，请先重置设置再修改", {
        ...(issue.path ? { path: issue.path } : {}),
      });
    }
  }

  function publicSettings(): PublicSettings {
    return {
      ...current,
      models: {
        roles: current.models.roles,
        connections: current.models.connections.map((c) => ({
          ...c,
          configured: c.keyless || Boolean(keys.get(c.id)),
        })),
      },
      secretsPersisted: opts.cipher.available(),
    };
  }

  return {
    settings: () => current,
    issue: () => issue,
    publicSettings,
    apiKey: (id) => keys.get(id) ?? "",
    connection(id) {
      const hit = current.models.connections.find((c) => c.id === id);
      if (!hit) throw new AppError("input.not_found", `未找到模型连接：${id}`, { connection: id });
      return hit;
    },
    async savePatch(patch) {
      assertEditable();
      await persistSettings(parseSettings(mergeSettingsPatch(current, patch)));
      return publicSettings();
    },
    async saveModels(input) {
      assertEditable();
      const connections = input.connections.map(({ apiKey: _apiKey, ...rest }) => rest);
      const next = parseSettings({ ...current, models: { connections, roles: input.roles } });
      for (const [role, binding] of Object.entries(input.roles)) {
        if (binding && !connections.some((c) => c.id === binding.connection)) {
          const keyPath = `$models.roles.${role}.connection`;
          throw new AppError("input.invalid", `${keyPath}: 未知连接 ${binding.connection}`, {
            path: keyPath,
          });
        }
      }
      for (const conn of input.connections) {
        if (conn.apiKey === undefined) continue;
        if (conn.apiKey === "") keys.delete(conn.id);
        else keys.set(conn.id, conn.apiKey.trim());
      }
      for (const id of [...keys.keys()]) {
        if (!connections.some((c) => c.id === id)) keys.delete(id);
      }
      await persistSecrets();
      await persistSettings(next);
      return publicSettings();
    },
    async setWorkspaceRoot(root) {
      assertEditable();
      await persistSettings({ ...current, workspaceRoot: root });
    },
    async reset() {
      issue = undefined;
      keys.clear();
      await persistSecrets();
      await persistSettings({ ...DEFAULT_SETTINGS, workspaceRoot: current.workspaceRoot });
      return publicSettings();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
