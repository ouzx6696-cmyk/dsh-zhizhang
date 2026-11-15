# 系统架构（v1.3）

## 1. 分层与守卫规则

```text
L3  apps/desktop          组合根 · IPC · 窗口 · PI 适配 · 渲染层
        │  仅经 package.json exports 门面导入
L2  @zhizhang/fanqie      @zhizhang/toutiao      ← 各自实现 ModeModule，互不引用
        │
L1  @zhizhang/workbench   @zhizhang/ui           ← 命令契约、TextSurface、--zz-* 令牌与 CopyKey
        │
L0  @zhizhang/core        errors / schema / fs / lock / journal / tool / pipeline / model / methods / python
```

[scripts/guard.mjs](scripts/guard.mjs) 统一执行以下静态守卫：

- **G-layer / G-facade**：层只能向下依赖；模式包互不引用；跨包禁止深入 `packages/*/src/`，只能使用 `package.json` `exports` 子路径。
- **G-app / G-pi**：`session/` 与 `renderer/` 不得导入 `main/`；`@earendil-works/pi-*` 仅限 [pi-adapter.ts](apps/desktop/src/session/pi-adapter.ts)。
- **G-core**：`core` 仅导入 `node:` 内置模块，严禁出现 `fanqie`/`toutiao` 等业务词。
- **G-error**：禁止 `packages/` 新增 `throw new Error(`；`apps/desktop/src/main/` 受 `mainRawError` 基线约束只减不增。
- **G-copy / G-rules**：`desktop/renderer` 与 `ui` 的 JSX 禁止写中文；业务常量 `84` / `34` 仅存于 [rules.py](packages/toutiao/skill/scripts/rules.py)，状态词与固定末句仅存于 [status.ts](packages/toutiao/src/domain/status.ts)。
- **G-type / G-exports / G-css / G-size / G-docs**：`any` ≤1、`!` = 0、`!:` = 0、`as` 受基线约束；校验 `exports` 路径与零引用导出基线；非令牌 CSS 禁止十六进制色与 `--ui-/--wb-`；单文件 >400 行提示；文档总数 ≤8 份。

## 2. 进程边界与 IPC

- **主进程组合根**（[apps/desktop/src/main/index.ts](apps/desktop/src/main/index.ts)）：注册 `ModeModule`、管理 `WorkflowService`（单活任务、断点指针）、分派 `WorkbenchCommandMap`、托管离线备份 utility process。
- **强类型契约**：渲染端经 [preload.ts](apps/desktop/src/preload.ts) 暴露的 `window.zhizhangBridge` 调用 [shared/ipc.ts](apps/desktop/src/shared/ipc.ts) 中定义的 `IpcMap`，并接收 [shared/events.ts](apps/desktop/src/shared/events.ts) 的判别联合 `DesktopEvent`。
- **模型网关与 PI 隔离**：所有流水线阶段通过 `ModelGateway`（全局并发闸默认 4、token 与金额预算、2s/6s/15s 退避、流式看门狗）调用 `ModelPort`，不直接耦合 PI SDK。

## 3. 流水线与状态机

- **流水线运行状态（`RunRecord.state`）**：`queued` → `running` → `paused`（预算/金额/取消/人工暂停）| `awaiting-author`（交付待确认）| `failed`；支持从 `paused` / `failed` 恢复断点继续。
- **番茄章节状态**：`planned` → `drafting` → `drafted` → `reviewed` → `final`。
- **头条文章状态**：`初稿待改` → `待验收` → `已验收` / `验收退回` → `已交稿`（终态不可逆，仅由作者确认触发）。

## 4. 磁盘格式（`zhizhang/1.3`）

- **应用状态目录**（`~/.zhizhang/` 或 `ZHIZHANG_STATE_ROOT`）：保存加密密钥、全局设置、运行指针与诊断日志（不随作品备份）。
- **本地写作文件夹**：
  - `.zhizhang/`：`lease.json`（跨进程租约）、`.zhizhang-lock/`（可重入资源写锁）、`drafts/`（草稿版本冲突保护）。
  - `长篇/<bookId>/`：`work.json`、`bible/`（`entities.json`、`states.json`、`threads.json`、`knowledge.json`、`chapters.json`、`style.json`、`pending.json`、`index.json`）、`plan/`、`chapters/`、`candidates/`、`runs/`。
  - `头条/<articleId>/`：`article.json`、`sources/`、`drafts/`、`qa/`、`delivery.md`、`runs/`。
- **多文件提交**：所有跨文件写入通过 `LockService` 加锁，经 `atomicWrite` + `Intent` 意图日志原子落盘并在启动时重放未完成意图。

## 5. 错误码与配置

- **错误码原则**：统一使用 `AppError` 与 `CODES`（[codes.ts](packages/core/src/errors/codes.ts)），按 `input.*`、`gate.*`、`storage.*`、`model.*`、`budget.*`、`internal` 分类，并在边界由 `classify()` 映射 errno 与 HTTP 状态。
- **配置模型**：全局设置由 [shared/settings.ts](apps/desktop/src/shared/settings.ts) 统一 schema 校验，包含五角色模型卡（写手/编辑/规划/评审/抽取）、引擎档位（经济/标准/精品）、token 与金额上限、全局并发数、外观（主题/字体/行长）与写作文件夹路径。

## 6. 测试体系规范

- **分层**：L1 `test/unit/`（纯规则与契约）→ L2 `test/engine/`（持久化、锁、意图、圣经、流水线编排）→ L3 桌面会话与 IPC → L4 Playwright E2E；Python `unittest` 负责规则计算与质检，TS 仅测调用、错误映射与落盘。
- **夹具与纪律**：L2 流水线测试使用 [test/support/fake-port.mjs](test/support/fake-port.mjs) 与 [test/support/clock.mjs](test/support/clock.mjs)，禁止真实 `sleep` 与跨用例共享队列；不写任何 1.x 旧格式兼容测试。
