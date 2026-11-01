import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../../../packages/core/src/fsx";
import {
  defaultModels,
  normalizeModels,
  publicModels,
} from "./models";
export type Appearance = {
  theme: "system" | "light" | "dark";
  font: "serif" | "sans";
  fontSize: number;
};
type Secrets = {
  available: () => boolean;
  encrypt: (text: string) => string;
  decrypt: (text: string) => string;
};
export class Settings {
  models = defaultModels();
  workspace = "";
  appearance: Appearance = { theme: "system", font: "serif", fontSize: 18 };
  searchKey = "";
  notices: string[] = [];
  constructor(
    readonly home: string,
    private secrets: Secrets,
  ) {}
  async readObject(file: string): Promise<Record<string, any>> {
    try {
      const value = JSON.parse(
        await readFile(path.join(this.home, file), "utf8"),
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("配置须为对象");
      return value;
    } catch (error: any) {
      if (error.code !== "ENOENT")
        this.notices.push(`${file} 无法读取，已使用默认设置。`);
      return {};
    }
  }
  async load() {
    const ui = await this.readObject("desktop.json");
    this.workspace = ui.workspace || "";
    this.appearance = { ...this.appearance, ...ui.appearance };
    const stored = await this.readObject("model.json"),
      source = stored.writer ? stored : { writer: stored };
    for (const role of ["writer", "editor", "planner"])
      if (source[role]?.secret) {
        try {
          if (!this.secrets.available()) throw new Error("系统安全存储不可用");
          source[role].apiKey = this.secrets.decrypt(source[role].secret);
        } catch {
          source[role].apiKey = "";
          this.notices.push(
            `${role === "editor" ? "编辑" : "写手"}模型 Key 无法解密，请重新填写。`,
          );
        }
      }
    try {
      this.models = normalizeModels(source);
    } catch {
      this.notices.push("模型配置无效，已恢复默认模型，请重新连接。");
    }
    const search = await this.readObject("search.json");
    if (search.secret) {
      try {
        if (!this.secrets.available()) throw new Error("系统安全存储不可用");
        this.searchKey = this.secrets.decrypt(search.secret);
      } catch {
        this.notices.push("搜索 Key 无法解密，请重新填写。");
      }
    }
  }
  public() {
    return {
      models: publicModels(this.models),
      workspace: this.workspace,
      appearance: this.appearance,
      searchConfigured: !!this.searchKey,
      secureStorage: this.secrets.available(),
    };
  }
  async saveModels(next: unknown) {
    const proposed = normalizeModels(next, this.models),
      stored: any = {};
    for (const [role, value] of Object.entries(proposed)) {
      if (!value) {
        stored[role] = null;
        continue;
      }
      const { apiKey, ...metadata } = value;
      stored[role] = {
        ...metadata,
        secret:
          apiKey && this.secrets.available()
            ? this.secrets.encrypt(apiKey)
            : undefined,
      };
    }
    await atomicWrite(
      path.join(this.home, "model.json"),
      JSON.stringify(stored, null, 2),
    );
    this.models = proposed;
    return this.secrets.available()
      ? ""
      : "系统安全存储不可用，Key 仅在本次运行中保留；下次启动需重新填写。";
  }
  async saveUI(next: { workspace?: string; appearance?: Partial<Appearance> }) {
    if (next.workspace !== undefined) this.workspace = next.workspace;
    if (next.appearance)
      this.appearance = { ...this.appearance, ...next.appearance };
    await atomicWrite(
      path.join(this.home, "desktop.json"),
      JSON.stringify(
        { workspace: this.workspace, appearance: this.appearance },
        null,
        2,
      ),
    );
  }
  async saveSearch(key: string) {
    const value = key.trim();
    if (!value) return;
    await atomicWrite(
      path.join(this.home, "search.json"),
      JSON.stringify({
        secret: this.secrets.available()
          ? this.secrets.encrypt(value)
          : undefined,
      }),
    );
    this.searchKey = value;
  }
  preferencesFile() {
    if (!this.workspace) throw new Error("请先选择统一写作根");
    return path.join(this.workspace, ".writer", "preferences.md");
  }
  async preferences() {
    if (!this.workspace) return "";
    try {
      return await readFile(this.preferencesFile(), "utf8");
    } catch (error: any) {
      if (error.code === "ENOENT") return "";
      throw error;
    }
  }
  async savePreferences(text: string) {
    if (Buffer.byteLength(text) > 32768)
      throw new Error("作者偏好请控制在 32 KB 内");
    const file = this.preferencesFile();
    await atomicWrite(file, text);
  }
}
