# 项目状态

当前版本：`2.3.1` ｜ 磁盘格式：`zhizhang/2.0`

## 1. 本地验证矩阵

> 以下为最近一次全量构建与自动化测试实测结果（在完成代码检查与测试后同步更新）：

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 + 代码规范 + 格式 + 架构守卫 | `npm run check` | 通过（`tsc -b` 零错误、`eslint` 零警告、`prettier` 全合规、`guard.mjs` 全绿） |
| 资产清单与引用完整性 | `npm run assets -- check` | 通过（全部哈希、版本与 `stage-map.json` 引用有效） |
| 自动化测试（Node） | `npm test` | 通过（116 项单元与引擎集成测试） |
| Web 预览与全仓构建 | `npm run build` | 通过（全仓 TS 包 + `apps/desktop/out/web` + `out/server`） |
| Electron 桌面端构建与暂存 | `npm run desktop:build` | 通过（主进程 + 预加载 + 渲染层 + 离线字体与资产暂存） |

## 2. 架构守卫基线

由 `scripts/guard.mjs` 与 `scripts/any-baseline.json` 持续守卫：

- 类型安全：`any = 0`、`! = 0`、`!: = 0`、`as ≤ 115`
- 错误规范：`packages/*/src/`、`apps/desktop/src/main/` 与 `apps/desktop/src/server/` 裸 `throw new Error(` 为 `0`
- 模块健康：全仓无死导出（`unusedExports = 0`），TS/TSX 文件超过 400 行时给出 `[G-size]` 提示
- 视觉与文案：全仓 `.tsx` 零 JSX 中文硬编码，非令牌 CSS 零十六进制色，文档数量 ≤ 6 份

## 3. 工作区包与模块清单

| 包名 | 职责 | 依赖关系 |
| --- | --- | --- |
| `@zhizhang/core` | 纯机制层（Schema、错误、原子文件、写锁、意图日志、流水线、预算、模型网关、方法加载） | 零外部依赖（仅 `node:*`） |
| `@zhizhang/ui` | 柔和纸面 C2 三层令牌、纯 React 无障碍原语、状态词与唯一文案源 | `@zhizhang/core`、React、Markdown |
| `@zhizhang/fanqie` | 番茄长篇领域、设定集、L0–L6 上下文、拆书/规划/写作/精修/记账/体检流水线、旧书导入与只读工具 | `@zhizhang/core` |
| `@zhizhang/toutiao` | 头条图文领域、TypeScript 规则引擎、文章流水线、证据核验、交稿单与台账、只读工具 | `@zhizhang/core` |
| `@zhizhang/workbench` | 50 条跨模式强类型命令契约、稿纸阅读与源码编辑器、原子草稿暂存 | `@zhizhang/{core,ui,fanqie,toutiao}` |
| `@zhizhang/desktop` | Electron 主进程、Web 预览服务、PI 会话引擎与 C2 React 渲染层 | `@zhizhang/{core,ui,fanqie,toutiao,workbench}` |

## 4. 远端 CI 覆盖与待外部环境验证项

- **远端 GitHub Actions（`.github/workflows/ci.yml`）**：
  - `check`（Ubuntu，Node 24）：`npm ci` → `npm run check` → `npm run assets -- check` → `npm run build`
  - `test`（Ubuntu + Windows，Node 24）：`npm test`
  - `e2e`（Windows）：Electron 二进制缓存安装 + `npm run test:e2e`
  - `package`（Windows，master / tag / 手动触发）：`electron-builder` NSIS/ZIP 打包 + 启动冒烟校验
- **受容器环境限制、需在 Windows Runner 或真实 API 环境下执行**：
  - Windows 原生 Electron E2E（`npm run test:e2e`）与安装包交付校验（`npm run release:verify`）
  - 真实付费模型端到端成稿质量对比基准（本仓库遵循未经批准不调用付费模型原则，自动化测试全程使用确定性本地桩）
