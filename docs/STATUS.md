# 项目状态

- **当前版本**：`2.3.0`（番茄长篇深度升级 T1–T6、柔和纸面 C2 整合、零超行拆分与 CI 全链路加固）
- **磁盘格式**：`zhizhang/2.0`
- **运行形态**：Electron 桌面主应用 + Node HTTP/SSE 本地 Web 预览（共享 `createAppRuntime`）

## 验证矩阵

| 检查项 | 范围 / 环境 | 状态 | 实测结果 |
| --- | --- | --- | --- |
| `npm run check` | `tsc -b` + ESLint + Prettier + `guard.mjs` | 通过 | strict 0 错误、ESLint 0 错误 0 告警、Prettier 全通过、`any = 0`、`! = 0`、`!: = 0`、`as = 116`、`mainRawError = 0`、`unusedExports = 0`、**0 条 `[G-size]` 告警**（304 个 TS/TSX、34 个 CSS、8 份核心文档） |
| `npm test` | Python `unittest`（头条 + 番茄）+ Node 106 项（`test/unit` & `test/engine`） | 通过 | 106 / 106 Node 测试通过（0 失败），头条与番茄 Python `unittest` 全部通过；完整覆盖 T1–T6（方法论挂载、去 AI 腔/轻润色与半章续写、跨书单实体时间线回查、连载存稿 KPI、旧书零模型批量接管、多分支衍生谱系与三分类沉淀）及全 49 条契约命令分派 |
| `npm run assets -- check` | `assets/sources.json` + `assets/manifest.json` + `stage-map.json` | 通过 | 清单哈希、上游版本号与双模式默认方案（含新增 `genres.md` 共 20 份番茄默认资产）阶段引用全部一致 |
| `npm run build` | 全仓 workspace + Web 预览构建 | 通过 | 零错误产出 `packages/*/dist` 与 `apps/desktop/out/web` |
| `npm run desktop:build` | Electron 主进程/预加载/渲染层 + `scripts/stage-desktop.mjs` | 通过 | 零错误产出 `apps/desktop/out/{main,preload,renderer}`，资源暂存与字体许可路径完备 |
| Web 预览实机浏览器验收 | `http://localhost:3000` + Headless Chromium（1440×900） | 通过 | 验收暗纸/晨纸双主题下的连载存稿缓冲栏、半章断点续写、去 AI 腔/轻润色专项模式、设定集跨书实体时间线回查（含别名展开与正文摘录）及旧书接管导入弹窗，零控制台与网络错误 |
| Windows 桌面打包与 E2E | GitHub Actions `windows-latest`（`ci / e2e` & `ci / package`） | CI 就绪 | 全部 Playwright `data-testid` 契约与 Electron 打包脚本已就绪，待在 Windows runner 执行打包与桌面端 E2E |
| 真实模型评测（RM01/RM02） | 需联网与作者书面批准预算 | 待批准 | 严格遵守未经书面批准不调用付费模型红线 |

## 模块健康概览

| 层级 | 包 / 目录 | 状态 | v2.3 关键演进 |
| --- | --- | --- | --- |
| L0 | `@zhizhang/core` | 健康 | `APP_VERSION` 升级至 `2.3.0`（`FORMAT_VERSION` 保持 `zhizhang/2.0`），延续 UTF-8 Python 桥接、非阻塞沙箱、原子意图日志与网关预算控制 |
| L1 | `@zhizhang/ui` / `@zhizhang/workbench` | 健康 | 拆分 `contract/policy.ts`，扩展至 49 条强类型命令契约与全量中文文案（零 JSX 硬编码）；延续柔和纸面 C2 三层令牌与一色一意纪律 |
| L2 | `@zhizhang/fanqie` | 健康 | 升级默认方案并新增 `genres.md`；落地 `revise(deai/polish)`、`chapter(continueFromExisting / previousCandidateId)`、`bible/trace.ts`、`computeSerialBuffer`、`commands/import.ts`、`reconcileDownstreamCandidates` 与三分类 `settlement` |
| L2 | `@zhizhang/toutiao` | 健康 | 坚守 `TITLE_MAX = 34`、`PASS_SCORE = 84`、2 轮上限、固定末句与状态词表红线，`writer_bridge.py` 原生卡片校验稳定运行 |
| L3 | `apps/desktop` | 健康 | 接入 `fanqie.bible.trace` / `fanqie.work.importLegacy` / 存稿 KPI 与过时下游分支透传；前端落地 `WorkflowStartForm` 续写与专项精修、`BibleTraceTab`、`StudioDashboard` 存稿栏与 `NewTargetDialog` 旧书导入入口 |

## 后续待办

1. **Windows 远端 CI 闭环**：在 GitHub Actions `windows-latest` 上验证 `ci / e2e`（Electron Playwright）与 `ci / package`（NSIS/ZIP + 随包 Python 冒烟）。
2. **付费模型试点评测**：在获得作者书面预算批准后执行 RM01/RM02 与番茄/头条 A/B 质量基准评测。
