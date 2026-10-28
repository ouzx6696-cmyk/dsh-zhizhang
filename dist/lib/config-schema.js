const PATH_FIELDS = ["storageRoot", "worksRoot", "libraryRoot", "sourceRoot"];
/** Describe each field once; both schema flavours are generated from this list. */
export const CONFIG_FIELDS = {
    rootDir: { type: "string", default: ".zhizhang", description: "数据目录（相对会话 cwd）" },
    storageRoot: { type: "string", description: "固定数据根（绝对路径）；存放分析、灵感、汇编及默认作品/库目录" },
    worksRoot: { type: "string", description: "作品目录；默认 <数据根>/works" },
    libraryRoot: { type: "string", description: "共享参考库目录；默认 <数据根>/library" },
    sourceRoot: { type: "string", description: "本地源书目录；按文件名导入 .txt/.md" },
    allowLanPanel: { type: "boolean", default: false, description: "允许非本机访问面板接口（仍检查 Host、Origin 与令牌）" },
    panelHosts: { type: "string[]", description: "LAN 访问时接受的主机名；缺省为本机网卡地址" },
    panelToken: { type: "string", description: "面板访问令牌；配置后本机与 LAN 请求都须携带", secret: true },
    multiDraftEnabled: { type: "boolean", description: "等价于 multiDraft.enabled（兼容旧配置）" },
    multiDraft: { type: "object", description: "同章多草稿统一整理" },
};
function fallbackSchema() {
    return {
        "~standard": {
            version: 1,
            vendor: "dsh-zhizhang",
            validate(input) {
                if (input === undefined || input === null)
                    input = {};
                if (typeof input !== "object" || Array.isArray(input))
                    return { issues: [{ message: "插件配置必须是对象" }] };
                const source = input;
                const value = { ...source };
                const issues = [];
                for (const [key, spec] of Object.entries(CONFIG_FIELDS)) {
                    const raw = source[key];
                    if (raw === undefined || raw === null) {
                        if (spec.default !== undefined)
                            value[key] = spec.default;
                        else
                            delete value[key];
                        continue;
                    }
                    const ok = spec.type === "string" ? typeof raw === "string"
                        : spec.type === "boolean" ? typeof raw === "boolean"
                            : spec.type === "string[]" ? Array.isArray(raw) && raw.every(item => typeof item === "string")
                                : typeof raw === "object" && !Array.isArray(raw);
                    if (!ok)
                        issues.push({ message: `${key} 应为 ${spec.type}`, path: [key] });
                }
                const multi = source.multiDraft;
                if (multi && typeof multi === "object" && multi.enabled !== undefined && typeof multi.enabled !== "boolean")
                    issues.push({ message: "multiDraft.enabled 应为 boolean", path: ["multiDraft", "enabled"] });
                for (const key of PATH_FIELDS)
                    if (typeof value[key] === "string" && !value[key].trim())
                        delete value[key];
                return issues.length ? { issues } : { value: value };
            },
        },
    };
}
function schemasterySchema(Schema) {
    const fields = {};
    for (const [key, spec] of Object.entries(CONFIG_FIELDS)) {
        let field;
        if (spec.type === "string")
            field = Schema.string();
        else if (spec.type === "boolean")
            field = Schema.boolean();
        else if (spec.type === "string[]")
            field = Schema.array(Schema.string());
        else
            field = Schema.object({ enabled: Schema.boolean().description("开启同章多草稿统一整理") });
        if (PATH_FIELDS.includes(key))
            field = Schema.transform(field, (value) => value?.trim() ? value : undefined);
        if (spec.secret && typeof field.role === "function")
            field = field.role("secret");
        if (spec.default !== undefined)
            field = field.default(spec.default);
        fields[key] = field.description(spec.description);
    }
    return Schema.object(fields);
}
/** Optional host schema adapter; installed but incompatible schemas fail at load. */
export async function createConfigSchema() {
    let module;
    try {
        module = await import("@deepseek-ai/schemastery");
    }
    catch {
        return fallbackSchema();
    }
    return schemasterySchema(module.default ?? module);
}
