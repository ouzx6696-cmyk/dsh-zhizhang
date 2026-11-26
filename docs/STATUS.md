# 项目状态

- **当前版本**：`2.3.0`（番茄长篇深度升级 T1–T6、正确性与并发可靠性全量加固 F01–F24、柔和纸面 C2 整合、零超行拆分与 CI 全链路加固）
- **磁盘格式**：`zhizhang/2.0`
- **运行形态**：Electron 桌面主应用 + Node HTTP/SSE 本地 Web 预览（共享 `createAppRuntime`）

## 验证矩阵

| 检查项 | 范围 / 环境 | 状态 | 实测结果 |
| --- | --- | --- | --- |
| `npm run check` | `tsc -b` + ESLint + Prettier + `guard.mjs` | 通过 | strict 0 错误、ESLint 0 错误 0 告警、Prettier 全通过、`any = 0`、`! = 0`、`!: = 0`、`as = 115`、`mainRawError = 0`、`unusedExports = 0`、**0 条 `[G-size]` 告警**（306 个 TS/TSX、34 个 CSS、8 份核心文档） |
| `npm test` | Python `unittest`（头条 + 番茄 228 项）+ Node 112 项（`test/unit` & `test/engine`） | 通过 | 112 / 112 Node 测试通过（0 失败 0 跳过），头条与番茄 Python `unittest` 共 228 项全部通过；完整覆盖 T1–T6、F01–F24（锁前缀续写、专项精修真实语义、原子意图前置冲突与沙箱回放、并发在途金额预留、设定集时间片与记账章号解析、BM25 内容键与逐项预算裁剪、原文逐字证据核验、头条验收修订绑定与交稿锁）及全 50 条契约命令分派 |
| `npm run assets -- check` | `assets/sources.json` + `assets/manifest.json` + `stage-map.json` | 通过 | 清单哈希、上游版本号与双模式默认方案（含 `genres.md` 共 20 份番茄默认资产）阶段引用全部一致 |
| `npm run build` | 全仓 workspace + Web 预览构建 | 通过 | 零错误产出 `packages/*/dist` 与 `apps/desktop/out/web` |
| `npm run desktop:build` | Electron 主进程/预加载/渲染层 + `scripts/stage-desktop.mjs` | 通过 | 零错误产出 `apps/desktop/out/{main,preload,renderer}`，资源暂存与离线字体许可路径完备 |
| Web 预览实机浏览器验收 | `http://localhost:3000` + Headless Chromium（1440×900） | 通过 | 验收番茄长篇工作室（存稿缓冲栏、半章续写/黄金章表单、无裁切右栏双卡）、旧书接管导入弹窗（默认 `drafted` + 切章预览按钮）与今日头条工作室，0 控制台错误、0 外链字体请求 |
| Windows 桌面打包与 E2E | GitHub Actions `windows-latest`（`ci / e2e` & `ci / package`） | 待远端验证 | 已移除 `index.html` 外链 Google Fonts 以满足严格 Electron CSP（完全走本地 `@fontsource/noto-serif-sc` 与系统字体）；Playwright `data-testid` 契约与打包脚本已就绪，待 Windows runner 实测 |
| 真实模型评测（RM01/RM02） | 需联网与作者书面批准预算 | 待批准 | 严格遵守未经书面批准不调用付费模型红线 |

## 模块健康概览

| 层级 | 包 / 目录 | 状态 | v2.3 关键演进 |
| --- | --- | --- | --- |
| L0 | `@zhizhang/core` | 健康 | `APP_VERSION` `2.3.0`（`FORMAT_VERSION` `zhizhang/2.0`）；新增 `commitIntent` 写锁内 `beforeHash` 前置冲突校验、`replayPendingIntents` `allowedRoots` 沙箱与写锁保护、`BudgetGuard` 并发在途金额预留 |
| L1 | `@zhizhang/ui` / `@zhizhang/workbench` | 健康 | 拆分 `contract/policy.ts`，扩展至 50 条强类型命令契约与全量中文文案（零 JSX 硬编码）；延续柔和纸面 C2 三层令牌与一色一意纪律 |
| L2 | `@zhizhang/fanqie` | 健康 | 升级默认方案并新增 `genres.md`；落地锁前缀半章续写、真实非审读语义 `revise(deai/polish)`、`bible/trace.ts`、`asOf` 付费节点/记账过滤、`context/format.ts` 逐项预算裁剪、`computeSerialBuffer` 章号缺口检测、`commands/{import,import-parse}.ts`、`commitIntent` 原子采纳与 `sourceHash` 过时检测 |
| L2 | `@zhizhang/toutiao` | 健康 | 坚守 `TITLE_MAX = 34`、`PASS_SCORE = 84`、2 轮上限、固定末句与状态词表红线；新增原文逐字证据核验、来源哈希失效、`acceptedRevision`/`deliveredRevision` 绑定与交稿后草稿只读锁 |
| L3 | `apps/desktop` | 健康 | 零外链离线字体满足 Electron 严格 CSP；接入 50 条命令与 `previewLegacyWork`、旧书默认 `drafted` 导入与预览、黄金章与前章候选分支选择器、过时分支琥珀告警与头条已交稿只读锁定 |

## 后续待办

1. **Windows 远端 CI 闭环**：在 GitHub Actions `windows-latest` 上验证 `ci / e2e`（Electron Playwright）与 `ci / package`（NSIS/ZIP + 随包 Python 冒烟）。
2. **付费模型试点评测**：在获得作者书面预算批准后执行 RM01/RM02 与番茄/头条 A/B 质量基准评测。
