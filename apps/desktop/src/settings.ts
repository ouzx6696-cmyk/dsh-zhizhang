import path from "node:path";
import { atomicWrite, readText } from "../../../packages/core/src/fsx";
import { defaultModels, normalizeModels, publicModels } from "./models";
import { FONT_SIZE, type Appearance } from "./appearance";
export type { Appearance } from "./appearance";
import { parseAppearance, asRecord } from "./main/ipc/validate";
import { Diagnostics } from "../../../packages/core/src/diagnostics";
type Secrets = {
  available: () => boolean;
  encrypt: (text: string) => string;
  decrypt: (text: string) => string;
};
export class Settings {
  models = defaultModels();
  workspace = "";
  appearance: Appearance = { theme: "dark", font: "serif", fontSize: FONT_SIZE.default };
  searchKey = "";
  notices: string[] = [];
  constructor(
    readonly home: string,
    private secrets: Secrets,
  ) {}
  async readObject(file: string): Promise<Record<string, unknown>> {
    try {
      const value = JSON.parse((await readText(path.join(this.home, file))) || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("配置须为对象");
      return value;
    } catch (error) {
      // allow-catch: 配置错误通过首次引导提示作者修复，不自动覆盖原文件。
      this.notices.push(`${file} 无法读取，已使用默认设置：${String(error)}`);
      return {};
    }
  }
  async load() {
    const ui = await this.readObject("desktop.json");
    try {
      if (ui.workspace !== undefined && typeof ui.workspace !== "string")
        throw new Error("写作根须为文本");
      this.workspace = ui.workspace ?? "";
      if (ui.appearance !== undefined)
        this.appearance = { ...this.appearance, ...parseAppearance(ui.appearance) };
    } catch (error) {
      // allow-catch: 外观配置不可用时展示修复提示，保留原文件。
      this.notices.push("外观配置无效，已使用默认设置：" + String(error));
    }
    const stored = await this.readObject("model.json");
    const legacy = !Object.hasOwn(stored, "writer") && Object.keys(stored).length > 0;
    const canonical = legacy ? { writer: stored } : stored;
    const source = structuredClone(canonical);
    for (const role of ["writer", "editor", "planner"] as const) {
      const value = source[role];
      if (!value) continue;
      const row = asRecord(value, "模型连接");
      if (row.secret) {
        try {
          if (!this.secrets.available()) throw new Error("系统安全存储不可用");
          if (typeof row.secret !== "string") throw new Error("Key 密文无效");
          row.apiKey = this.secrets.decrypt(row.secret);
        } catch (error) {
          // allow-catch: 密钥解密失败后要求作者重新输入，不将密文当作有效 Key。
          row.apiKey = "";
          this.notices.push(
            `${role === "editor" ? "编辑" : role === "planner" ? "规划" : "写手"}模型 Key 无法解密，请重新填写：${String(error)}`,
          );
        }
      }
    }
    try {
      this.models = normalizeModels(source);
      if (legacy) {
        await atomicWrite(path.join(this.home, "model.json"), JSON.stringify(canonical, null, 2));
        await new Diagnostics(this.home).write("legacy_model_migrated");
      }
    } catch (error) {
      // allow-catch: 模型配置错误显示引导提示，不自动改写原文件。
      this.notices.push("模型配置无效，已恢复默认模型，请重新连接：" + String(error));
    }
    const search = await this.readObject("search.json");
    if (search.secret) {
      try {
        if (!this.secrets.available()) throw new Error("系统安全存储不可用");
        if (typeof search.secret !== "string") throw new Error("搜索 Key 密文无效");
        this.searchKey = this.secrets.decrypt(search.secret);
      } catch (error) {
        // allow-catch: 搜索密钥无法解密时告知作者重新输入。
        this.notices.push("搜索 Key 无法解密，请重新填写：" + String(error));
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
      stored: Record<string, unknown> = {};
    for (const [role, value] of Object.entries(proposed)) {
      if (!value) {
        stored[role] = null;
        continue;
      }
      const { apiKey, ...metadata } = value;
      stored[role] = {
        ...metadata,
        secret: apiKey && this.secrets.available() ? this.secrets.encrypt(apiKey) : undefined,
      };
    }
    await atomicWrite(path.join(this.home, "model.json"), JSON.stringify(stored, null, 2));
    this.models = proposed;
    return this.secrets.available()
      ? ""
      : "系统安全存储不可用，Key 仅在本次运行中保留；下次启动需重新填写。";
  }
  async saveUI(next: { workspace?: string; appearance?: Partial<Appearance> }) {
    if (next.workspace !== undefined) this.workspace = next.workspace;
    if (next.appearance) this.appearance = { ...this.appearance, ...next.appearance };
    await atomicWrite(
      path.join(this.home, "desktop.json"),
      JSON.stringify({ workspace: this.workspace, appearance: this.appearance }, null, 2),
    );
  }
  async saveSearch(key: string) {
    const value = key.trim();
    await atomicWrite(
      path.join(this.home, "search.json"),
      JSON.stringify({
        secret: this.secrets.available() ? this.secrets.encrypt(value) : undefined,
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
    return (await readText(this.preferencesFile())) ?? "";
  }

  async savePreferences(text: string) {
    if (Buffer.byteLength(text) > 32768) throw new Error("作者偏好请控制在 32 KB 内");
    const file = this.preferencesFile();
    await atomicWrite(file, text);
  }
}
