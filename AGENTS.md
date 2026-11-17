# 织章协作与开发规范

- 适用代码基线：发布版本 `v1.3.0`；当前开发分支 `feat/v1.4-complete` 基于 `integration/v1.4@96f8f2e`，v1.4 功能实现与本地验证已完成，提交 / 推送 / 合并待执行；v1.4 未发布
- 本文件是协作与交付的硬约束；与 `docs/` 冲突时以本文件为准。

## 禁止事项

- **业务规则红线**：未经作者明确授权，不得修改核心业务规则——头条标题上限 `34` 字（[rules.py](packages/toutiao/skill/scripts/rules.py)）、质检及格线 `84` 分（`PASS_SCORE = 84`）、编辑两轮打回上限、头条交稿固定末句、番茄/头条状态词表。
- **资产与兼容**：不得留存任何 1.x 旧格式或已退役开关的兼容分支；读取不认识的磁盘格式统一报 `storage.format_unsupported`。不得在 TS 侧重复定义 Python 规则常量。
- **分层与依赖**：`@zhizhang/core` 只允许导入 `node:` 内置模块，严禁出现 `fanqie`/`toutiao` 业务词；`@zhizhang/fanqie` 与 `@zhizhang/toutiao` 严禁互相引用；跨包只能经 `package.json` `exports` 门面导入；`session/` 与 `renderer/` 严禁导入 `main/`；PI SDK 仅限 `apps/desktop/src/session/pi-adapter.ts`。
- **费用与发版**：未经作者书面批准，不得调用任何付费模型、不得变更发版规则或自动发布。
- **计划基线**：`plans/v1.4/baseline/` 为作者原件的只读快照（附 `SHA256SUMS.txt`），不得修改；进度与裁决只写 `plans/v1.4/tracker.md`。

## 交付流程与命令

- `npm run check`：依次执行 `tsc -b`、`node scripts/selftest.ts`、`eslint .`、`prettier --check .`、`node scripts/guard.mjs`、`node scripts/check-ratchet.mjs`、`node scripts/check-budget.mjs`（目标 ≤60 s；2026-11-17 实测约 25 s）。
- `npm test`：运行 `packages/toutiao/skill/tests` 与 `packages/fanqie/skill/tests` 的 Python `unittest`（226 + 1 项），以及 `test/unit/*.test.mjs`、`test/engine/*.test.mjs`（当前 230 项，master 基线 83 项；目标 ≤90 s）。Windows 下设置 `PYTHONUTF8=1` 与 `PYTHONIOENCODING=utf-8`，避免规则桥中文按 GBK 乱码。
- `npm run test:e2e`：构建桌面端并执行 Playwright 端到端旅程测试（16 条；目标 ≤4 min）；本机 Windows 需 `ELECTRON_DISABLE_SANDBOX=1`，并设置 `PYTHONUTF8=1` 与 `PYTHONIOENCODING=utf-8`。
- `npm run release:verify`：仅限 Windows，准备随包 Python、执行 `electron-builder` 打包并运行 `scripts/check-desktop-package.mjs`。
- 其他：`npm run assets`（资产清单）、`npm run desktop:dev`、`npm run desktop:build`、`npm run desktop:pack` / `desktop:portable`。

## 代码与测试约定

- **错误模型**：全仓统一使用 `AppError` + `CODES`（23 个码）；禁止在 `packages/` 与 `apps/desktop/src/main/` 新增裸 `throw new Error(`；禁止通过正则匹配中文错误文案判断错误码。
- **类型安全**：全仓 TS strict 零错误；`any` ≤1；非空断言 `!` 与确定赋值断言 `!:` 为 0；`as` 类型断言受 [any-baseline.json](scripts/any-baseline.json) 约束只减不增（当前 176，基线 258）。
- **测试规范**：
  - 归层：纯规则与计算入 `test/unit/`；存储/锁/门禁/流水线入 `test/engine/`；会话与桌面集成在桌面层；界面交互入 E2E。
  - 分工：Python 测规则与 JSON 契约，TS 只测调用、错误映射与落盘，不重复断言评分细节。
  - 入口与夹具：只经公开导出、`executeTool`、`executePipeline`（配 `test/support/fake-port.mjs`）进入；禁止 `sleep` 与真实超时等待，统一注入 `test/support/clock.mjs`。
  - 命名与无兼容：按“什么情况下 → 可观察结果”命名，不写工单号，不写已删除旧格式的兼容测试。
- **静态守卫**：`guard.mjs` 共 14 条——`G-core`、`G-layer`、`G-facade`、`G-app`、`G-pi`、`G-type`、`G-size`、`G-copy`、`G-error`、`G-exports`、`G-brand`、`G-docs`、`G-rules`、`G-css`；`check-ratchet.mjs` 与 `check-budget.mjs` 追加棘轮与体积门。

## 文档维护

- 文档总量受 `G-docs` 约束：`docs/` + `README.md` + `AGENTS.md` + `CHANGELOG.md` ≤8 份（当前 7 份）。
- `G-docs` 只约束工程文档；`plans/` 与 `packages/*/profiles`、`packages/*/skill` 属计划/资产层，不纳入该上限，但各自必须保持单一真源。
- `docs/` 描述**当前代码基线**：发布版本 `1.3.0`；当前开发分支 `feat/v1.4-complete`，基于 `integration/v1.4@96f8f2e`，本轮功能实现已通过本地验证，合并待执行。每份文档在开头标注适用范围与发布版本；版本号只在发版时提升，发版时统一升版。
- 精确进度只写 `plans/v1.4/tracker.md`；`docs/STATUS.md` 只在波次门与发版门更新，`README.md` 只写阶段概览，不重复卡数。
- 数字以实跑为准：验证数字、契约规模、文件行数更新前必须重新执行对应命令，不引用旧口径。
- 契约或磁盘格式变更时，同步更新 `docs/ARCHITECTURE.md`（结构）与 `docs/WRITING.md`（规则），并在 `CHANGELOG.md` 的 `Unreleased` 记录。
- `plans/` 不进版本库（`.git/info/exclude` 排除）；`plans/v1.4/` 是 v1.4 的计划、进度与盘点工作区。

## 仓库目录

- `packages/core`：纯机制层（errors / schema / fs / lock / journal / tool / pipeline / model / methods / python / id / text）
- `packages/fanqie`：番茄长篇模式（domain / bible / outline / import / context / storage / learning / pipelines / commands / tools / view / profiles / skill）
- `packages/toutiao`：头条图文模式（domain / rules / storage / pipelines / commands / tools / view / workbench / profiles / skill）
- `packages/*/profiles`：stage-map 直接取用的方法 Markdown；`packages/*/skill`：独立技能资产，不是应用运行时源码。
- `packages/workbench` & `packages/ui`：写作区视图、命令契约、`TextSurface`、`--zz-*` 令牌与 `CopyKey` 文案
- `apps/desktop`：Electron 组合根、IPC、PI 适配、会话管理与渲染层
- `scripts/` & `test/`：架构守卫、棘轮与体积预算、打包冒烟、离线备份与自动化测试
- `plans/`：v1.4 计划、进度、验收与基线快照（不进版本库）
