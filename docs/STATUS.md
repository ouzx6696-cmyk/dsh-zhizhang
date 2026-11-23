# 项目状态

- **当前版本**：`2.0.0`（v2.1 全链路架构优化与文档体系重构）
- **磁盘格式**：`zhizhang/2.0`
- **运行形态**：Electron 桌面主应用 + Node HTTP/SSE 本地 Web 预览（共享 `createAppRuntime`）

## 验证矩阵

| 检查项 | 范围 / 环境 | 状态 | 说明 |
| --- | --- | --- | --- |
| `npm run check` | `tsc -b` + ESLint + Prettier + `guard.mjs` | 通过 | strict 0 错误、ESLint 0 告警、`any = 0`、`! = 0`、`as = 122`、`unusedExports = 0`、`docs = 8` |
| `npm test` | Python `unittest`（头条 228 项 + 番茄）+ Node 76 项（`test/unit` & `test/engine`） | 通过 | 覆盖 Python 规则桥、UTF-8 流式分块、设定集索引与缓存、预算裁剪、会话并发、RunStore 损坏隔离、Web 预览安全边界与核心状态机 |
| `npm run assets -- check` | `assets/sources.json` + `assets/manifest.json` + `stage-map.json` | 通过 | 清单 497 条哈希、上游版本号及双模式默认方案阶段引用全部一致 |
| `npm run build` | 全仓 workspace + Web 预览构建 | 通过 | 无错误生成 `packages/*/dist` 与 `apps/desktop/out/web` |
| Web 预览实机浏览器验收 | `http://localhost:3000` + Headless Chromium（1440×900） | 通过 | 验证双模式切换、番茄稿纸编辑与持久化、头条草稿编辑与台账、设置与深色主题切换、零控制台与网络错误 |
| Windows 桌面打包与 E2E | 需 Windows 宿主（CI `e2e` / `package` job） | 待宿主运行 | 包含 Playwright Electron E2E、`electron-builder` NSIS/ZIP 与 W1–W20 检查单 |
| 真实模型评测（RM01/RM02） | 需联网与作者书面批准预算 | 待批准 | 严格遵守未批准不调付费模型红线 |

## 模块健康概览

| 层级 | 包 / 目录 | 状态 | v2.1 关键加固 |
| --- | --- | --- | --- |
| L0 | `@zhizhang/core` | 健康 | UTF-8 `Buffer` 合并、`PYTHONUTF8=1`、锁命名空间与 `EPERM` 修复、非阻塞沙箱、全量 Schema 校验、网关记账与取消语义区分 |
| L1 | `@zhizhang/ui` / `@zhizhang/workbench` | 健康 | `desktop.ts` 文案分治、草稿原子写与可注入时钟、零死导出、`.tsx` 零中文硬编码 |
| L2 | `@zhizhang/fanqie` | 健康 | `bible/` 三文件拆解与索引巡检、2-gram LRU + 严格预算裁剪、章节评分/比较并行、修稿门禁失败安全回退、`book` 流水线拆解 |
| L2 | `@zhizhang/toutiao` | 健康 | `writer_bridge.py` 原生 `check-card` 与 `limits.styles`、消除内联 Python、真实 `ContextPacket`、质检 `.tmp/` 隔离 |
| L3 | `apps/desktop` | 健康 | `commands.ts` 分治、Web 预览沙箱/同源/导出下载加固、SSE 容错重连、会话串行+LRU+只读工具并发、PI 15s 超时、`RunStore` 损坏隔离与裁剪 |

## 后续待办

1. **Windows 交付验证**：在 Windows 宿主或 GitHub Actions `windows-latest` 上完成 `npm run test:e2e` 与 `npm run release:verify`。
2. **付费模型试点评测**：在获得作者书面预算批准后执行 RM01/RM02 与 A/B 质量评测。
