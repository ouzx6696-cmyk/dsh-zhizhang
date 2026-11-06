/** 今日头条模式的配置（writer-agent 配置的 toutiao 段）。 */
import { parseAssetsConfig, type AssetsConfig } from "../../core/src/user-assets.js";

export interface ToutiaoConfig {
  /** 相对会话 cwd 的数据目录，默认 outputs/toutiao */
  rootDir?: string;
  /** 固定的绝对数据目录，设置后忽略 rootDir */
  storageRoot?: string;
  /** Python 命令，如 C:\\Python312\\python.exe 或 "py -3" */
  python?: string;
  /** 关闭的非锁定门禁 id */
  disabledGates?: string[];
  /** true：送“待验收”前当前版本必须出自编辑子代理或作者（写手与编辑分离），默认 false */
  requireEditorPass?: boolean;
  /** handoff.v2：任务交接改用方法包决策表（按文章状态注入 S 步方法），默认关 */
  handoff?: { v2?: boolean };
  /** 会话策略：proactiveCompact 主动压缩（写手任务结算空闲后上下文达窗口 75% 即整理），默认关 */
  session?: { proactiveCompact?: boolean };
  /** 常驻规则重排：创作定向在前、工程约束整段压后，默认关 */
  brief?: { creationFirst?: boolean };
  /** 作者自备方法 / 语料目录（toutiao_method_get id=user:…）；见 docs/guides/ASSETS.md */
  assets?: AssetsConfig;
  /** 固定使用的方法方案（默认 / 原版 / 用户方案名或 id）；不填则用写作台或工具选的当前方案 */
  profile?: string;
}

export type Issue = { message: string; path: (string | number)[] };
const STRINGS = ["rootDir", "storageRoot", "python", "profile"] as const;
const KNOWN = new Set<string>([
  ...STRINGS,
  "requireEditorPass",
  "disabledGates",
  "handoff",
  "session",
  "brief",
  "assets",
]);

/** 校验并填默认值；未知字段报错 */
export function parseToutiaoConfig(
  input: unknown,
  at: string[] = ["toutiao"],
): { value?: ToutiaoConfig; issues: Issue[] } {
  const issues: Issue[] = [];
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input))
    return { issues: [{ message: `${at.join(".")} 应为对象`, path: at }] };
  const v = input as Record<string, unknown>;
  const out: ToutiaoConfig = {};
  for (const k of Object.keys(v))
    if (!KNOWN.has(k))
      issues.push({ message: `${[...at, k].join(".")} 不是有效配置项`, path: [...at, k] });
  for (const k of STRINGS) {
    const x = v[k];
    if (x === undefined) continue;
    if (typeof x !== "string")
      issues.push({ message: `${[...at, k].join(".")} 应为字符串`, path: [...at, k] });
    else if (x.trim()) out[k] = x.trim();
  }
  if (v.requireEditorPass !== undefined) {
    if (typeof v.requireEditorPass !== "boolean")
      issues.push({
        message: `${[...at, "requireEditorPass"].join(".")} 应为布尔值`,
        path: [...at, "requireEditorPass"],
      });
    else out.requireEditorPass = v.requireEditorPass;
  }
  if (v.disabledGates !== undefined) {
    if (!(Array.isArray(v.disabledGates) && v.disabledGates.every((x) => typeof x === "string")))
      issues.push({
        message: `${[...at, "disabledGates"].join(".")} 应为字符串数组`,
        path: [...at, "disabledGates"],
      });
    else out.disabledGates = v.disabledGates as string[];
  }
  if (v.handoff !== undefined) {
    const h = v.handoff as Record<string, unknown> | null;
    if (
      !h ||
      typeof h !== "object" ||
      Array.isArray(h) ||
      (h.v2 !== undefined && typeof h.v2 !== "boolean")
    )
      issues.push({
        message: `${[...at, "handoff"].join(".")} 应为 { v2: 布尔值 }`,
        path: [...at, "handoff"],
      });
    else out.handoff = { v2: h.v2 === true };
  }
  if (v.session !== undefined) {
    const s = v.session as Record<string, unknown> | null;
    if (
      !s ||
      typeof s !== "object" ||
      Array.isArray(s) ||
      (s.proactiveCompact !== undefined && typeof s.proactiveCompact !== "boolean")
    )
      issues.push({
        message: `${[...at, "session"].join(".")} 应为 { proactiveCompact: 布尔值 }`,
        path: [...at, "session"],
      });
    else out.session = { proactiveCompact: s.proactiveCompact === true };
  }
  if (v.brief !== undefined) {
    const b = v.brief as Record<string, unknown> | null;
    if (
      !b ||
      typeof b !== "object" ||
      Array.isArray(b) ||
      (b.creationFirst !== undefined && typeof b.creationFirst !== "boolean")
    )
      issues.push({
        message: `${[...at, "brief"].join(".")} 应为 { creationFirst: 布尔值 }`,
        path: [...at, "brief"],
      });
    else out.brief = { creationFirst: b.creationFirst === true };
  }
  if (v.assets !== undefined) {
    const a = parseAssetsConfig(v.assets, [...at, "assets"]);
    issues.push(...a.issues);
    if (a.value) out.assets = a.value;
  }
  out.rootDir ??= "outputs/toutiao";
  return issues.length ? { issues } : { value: out, issues };
}
