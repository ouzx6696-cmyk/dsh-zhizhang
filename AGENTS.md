# 织章协作与开发规范

## 禁止事项

- **业务规则红线**：未经作者明确授权，不得修改核心业务规则——头条标题上限 `34` 字（[rules.py](packages/toutiao/skill/scripts/rules.py)）、质检及格线 `84` 分（`PASS_SCORE = 84`）、编辑两轮打回上限、头条交稿固定末句、番茄/头条状态词表。
- **资产与兼容**：不得留存任何 1.x 旧格式或已退役开关的兼容分支；读取不认识的磁盘格式统一报 `storage.format_unsupported`。不得在 TS 侧重复定义 Python 规则常量。
- **分层与依赖**：`@zhizhang/core` 只允许导入 `node:` 内置模块，严禁出现 `fanqie`/`toutiao` 业务词；`@zhizhang/fanqie` 与 `@zhizhang/toutiao` 严禁互相引用；跨包只能经 `package.json` `exports` 门面导入；`session/` 与 `renderer/` 严禁导入 `main/`；PI SDK 仅限 `apps/desktop/src/session/pi-adapter.ts`。
- **费用与发版**：未经作者书面批准，不得调用任何付费模型、不得变更发版规则或自动发布。

## 交付流程与命令

- `npm run check`：依次执行 `tsc -b`、`eslint .`、`prettier --check .` 与 `node scripts/guard.mjs`（目标 ≤60 s）。
- `npm test`：运行 `packages/toutiao/skill/tests` 与 `packages/fanqie/skill/tests` 的 Python `unittest`，以及 `test/unit/*.test.mjs`、`test/engine/*.test.mjs`（目标 ≤90 s）。
- `npm run test:e2e`：构建桌面端并执行 Playwright 端到端旅程测试（目标 ≤4 min）。
- `npm run release:verify`：仅限 Windows，准备随包 Python、执行 `electron-builder` 打包并运行 `scripts/check-desktop-package.mjs`。

## 代码与测试约定

- **错误模型**：全仓统一使用 `AppError` + `CODES` 码表；禁止在 `packages/` 与 `apps/desktop/src/main/` 新增裸 `throw new Error(`；禁止通过正则匹配中文错误文案判断错误码。
- **类型安全**：全仓 TS strict 零错误；`any` ≤1；非空断言 `!` 与确定赋值断言 `!:` 为 0；`as` 类型断言受 `scripts/any-baseline.json` 基线约束只减不增。
- **测试规范**：
  - 归层：纯规则与计算入 `test/unit/`；存储/锁/门禁/流水线入 `test/engine/`；会话与桌面集成在桌面层；界面交互入 E2E。
  - 分工：Python 测规则与 JSON 契约，TS 只测调用、错误映射与落盘，不重复断言评分细节。
  - 入口与夹具：只经公开导出、`executeTool`、`executePipeline`（配 `test/support/fake-port.mjs`）进入；禁止 `sleep` 与真实超时等待，统一注入 `test/support/clock.mjs`。
  - 命名与无兼容：按“什么情况下 → 可观察结果”命名，不写工单号，不写已删除旧格式的兼容测试。

## 仓库目录

- `packages/core`：纯机制层（errors / schema / fs / lock / journal / tool / pipeline / model / methods / python）
- `packages/fanqie`：番茄长篇模式（domain / bible / storage / context / pipelines / commands / tools / view）
- `packages/toutiao`：头条图文模式（domain / storage / rules / pipelines / commands / tools / view / skill）
- `packages/workbench` & `packages/ui`：写作区视图、命令契约、`TextSurface`、`--zz-*` 令牌与 `CopyKey` 文案
- `apps/desktop`：Electron 组合根、IPC、PI 适配、会话管理与渲染层
- `scripts/` & `test/`：架构守卫、打包冒烟、离线备份与自动化测试
