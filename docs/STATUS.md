# 项目状态

- **当前版本**：`2.2.0`（五大灵感源全量对齐、柔和纸面 C2 整合、零超行拆分与 CI 全链路加固）
- **磁盘格式**：`zhizhang/2.0`
- **运行形态**：Electron 桌面主应用 + Node HTTP/SSE 本地 Web 预览（共享 `createAppRuntime`）

## 验证矩阵

| 检查项 | 范围 / 环境 | 状态 | 实测结果 |
| --- | --- | --- | --- |
| `npm run check` | `tsc -b` + ESLint + Prettier + `guard.mjs` | 通过 | strict 0 错误、ESLint 0 错误 0 告警、Prettier 全通过、`any = 0`、`! = 0`、`!: = 0`、`as = 116`、`mainRawError = 0`、`unusedExports = 0`、**0 条 `[G-size]` 告警**（300 个 TS/TSX、34 个 CSS、8 份文档） |
| `npm test` | Python `unittest`（头条 21 组 / 228 断言 + 番茄）+ Node 96 项（`test/unit` & `test/engine`） | 通过 | 96 / 96 Node 测试通过（0 失败），头条与番茄 Python `unittest` 全部通过；覆盖段落级 diff 与局部采纳、D3 仪表盘模型、PI 会话并发与溢出压缩、技法库、设定集索引、Web 预览安全边界与核心状态机 |
| `npm run assets -- check` | `assets/sources.json` + `assets/manifest.json` + `stage-map.json` | 通过 | 清单哈希、上游版本号与双模式默认方案阶段引用全部一致 |
| `npm run build` | 全仓 workspace + Web 预览构建 | 通过 | 零错误产出 `packages/*/dist` 与 `apps/desktop/out/web` |
| `npm run desktop:build` | Electron 主进程/预加载/渲染层 + `scripts/stage-desktop.mjs` | 通过 | 零错误产出 `apps/desktop/out/{main,preload,renderer}`，修复 hoisted `node_modules` 下 `@fontsource/noto-serif-sc/LICENSE` 定位 |
| Web 预览实机浏览器验收 | `http://localhost:3000` + Headless Chromium（1440×900） | 通过 | 验收柔和纸面 C2 晨纸/暗纸双主题、Studio D3 仪表盘、项目工作台、技法仓库交互式编辑器、零控制台与网络错误 |
| Windows 桌面打包与 E2E | GitHub Actions `windows-latest`（`ci / e2e` & `ci / package`） | CI 就绪 | 已审计全部 63 个 Playwright `data-testid` 契约并修复 `stage-desktop.mjs` 字体许可路径，待在 Windows runner 执行打包与电子端 E2E |
| 真实模型评测（RM01/RM02） | 需联网与作者书面批准预算 | 待批准 | 严格遵守未经书面批准不调用付费模型红线 |

## 模块健康概览

| 层级 | 包 / 目录 | 状态 | v2.2 关键演进 |
| --- | --- | --- | --- |
| L0 | `@zhizhang/core` | 健康 | UTF-8 `Buffer` 拼接、`PYTHONUTF8=1`、锁命名空间与 `EPERM` 修复、非阻塞沙箱、全量 Schema 校验、网关记账与取消语义区分 |
| L1 | `@zhizhang/ui` / `@zhizhang/workbench` | 健康 | 柔和纸面 C2 三层令牌（`palette` → `semantic` → `component`）、删除旧古风主题与未定义变量、拆分 `contract/{commands,views}.ts` |
| L2 | `@zhizhang/fanqie` | 健康 | 拆分 `pipelines/dissect/schemas.ts`、`pipelines/book/apply.ts`、`context/retrieval.ts`、`bible/{schemas,audit,store}.ts`；贯通拆书→规划→分层上下文与技法注入 |
| L2 | `@zhizhang/toutiao` | 健康 | `writer_bridge.py` 原生 `check-card` 与 `limits.styles`、消除内联 Python、真实 `ContextPacket`、质检 `.tmp/` 隔离 |
| L3 | `apps/desktop` | 健康 | 柔和纸面 C2 无顶栏三栏布局、D3 创作内核仪表盘、决策卡+双稿纸逐处采纳、技法仓交互式 Markdown 编辑器、PI 内核深度整合（`pi-adapter` + `pi-helpers` + `turn-runner`）、全面拆分超 400 行 TSX/TS/CSS 与死样式清理 |

## 后续待办

1. **Windows 远端 CI 闭环**：在 GitHub Actions `windows-latest` 上验证 `ci / e2e`（Electron Playwright）与 `ci / package`（NSIS/ZIP + 随包 Python 冒烟）。
2. **付费模型试点评测**：在获得作者书面预算批准后执行 RM01/RM02 与番茄/头条 A/B 质量基准评测。
