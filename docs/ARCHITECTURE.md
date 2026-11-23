# 系统架构（v2.1）

## 1. 分层依赖与架构守卫

```text
L3  apps/desktop          共享组合根(app-runtime) · 双宿主(Electron IPC + Web HTTP/SSE) · PI 适配 · 会话 · 渲染层
        │  仅经 package.json exports 门面导入
L2  @zhizhang/fanqie      @zhizhang/toutiao      ← 各自实现 ModeModule，严禁互引
        │
L1  @zhizhang/workbench   @zhizhang/ui           ← 44 条命令契约、TextSurface、--zz-* 令牌与 CopyKey
        │
L0  @zhizhang/core        clock / errors / schema / fs / lock / journal / tool / pipeline / model / methods / python
```

[scripts/guard.mjs](scripts/guard.mjs) 在 `npm run check` 中静态执行全仓门禁：

| 守卫代号 | 约束内容 |
| --- | --- |
| `G-core` | `packages/core` 仅允许导入 `node:` 内置模块与包内模块，严禁出现 `fanqie`/`toutiao` 业务词 |
| `G-layer` / `G-facade` | 依赖只能向下；`fanqie` 与 `toutiao` 零互引；跨包严禁深导 `packages/*/src/` |
| `G-app` / `G-pi` | `session/` 与 `renderer/` 严禁导入 `main/`；`@earendil-works/pi-*` 仅限 `session/pi-adapter.ts` |
| `G-error` | `packages/*/src/`、`apps/desktop/src/main/`、`apps/desktop/src/server/` 零裸 `throw new Error(` |
| `G-copy` / `G-rules` | 全部 `.tsx` 零 JSX 中文硬编码；`84` / `34` 仅存于 `rules.py`；状态词表与固定末句仅存于 `domain/status.ts` |
| `G-type` / `G-exports` | `any = 0`、`! = 0`、`!: = 0`、`unusedExports = 0`、`as` 只减不增；验证全部 `package.json` `exports` 存在 |
| `G-css` / `G-size` / `G-docs` | 非令牌 CSS 禁止十六进制色与旧前缀；单文件 `≤ 400` 行；核心文档总数 `≤ 8` 份 |

## 2. 双宿主运行态与传输无关 RPC

```text
                 ┌──────────────────────────┐
                 │    React Renderer UI     │
                 │  desktop.ts (自动选择桥)   │
                 └──────┬────────────┬──────┘
      Electron Preload  │            │  Web Preview (无 preload)
   window.zhizhangBridge│            │  web-bridge.ts (POST + EventSource)
                        ▼            ▼
             ┌───────────────────────────────┐
             │  createRpcHandlers (传输无关)  │
             │  IpcMap 校验 + AppError 序列化 │
             └───────────────┬───────────────┘
                             ▼
             ┌───────────────────────────────┐
             │ createAppRuntime (无 Electron) │
             │ Config · Workspace · Workflow  │
             │ Session · Models · Health      │
             └───────────────┬───────────────┘
                             ▼
               HostPlatform (Electron | Web)
```

- **宿主抽象**（[apps/desktop/src/main/platform.ts](apps/desktop/src/main/platform.ts)）：隔离文件对话框、系统打开、剪贴板、系统密钥库（`safeStorage` / Web 内存回退）与独立进程离线备份。
- **共享组合根**（[apps/desktop/src/main/app-runtime.ts](apps/desktop/src/main/app-runtime.ts)）：装配 `ConfigService`、`WorkspaceService`、`ModelServices`、`RunStore`、`WorkflowService`、`SessionManager`、`StorageHealth` 与 `CommandCtx`，在 `dispose()` 时按序退订监听、取消备份、停止流水线与会话、释放租约锁。
- **Electron 主宿主**（[apps/desktop/src/main/index.ts](apps/desktop/src/main/index.ts)）：通过 `register.ts` 将 `createRpcHandlers` 绑定到 `ipcMain.handle`，由 `preload.ts` 暴露最小权限 `window.zhizhangBridge`。
- **Web 预览宿主**（[apps/desktop/src/server/web-server.ts](apps/desktop/src/server/web-server.ts)）：监听 `0.0.0.0:3000`，提供：
  - `GET /api/health`：运行态探活；
  - `POST /api/rpc/:channel`：强制同源 `Origin`（对比 `Host` / `X-Forwarded-Host`）与 `application/json` 校验，25 MiB 请求体上限，通道白名单分派；
  - `GET /api/events`：SSE 事件流（25s 心跳 + `safeWriteSse` 失效客户端自动清理，前端断线重连后自动拉取最新工作区状态）；
  - `GET /api/exports/:file` 与静态资源：经 `resolveInsideAsync` 沙箱约束，附带 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 与分层 `Cache-Control`。

## 3. 核心引擎机制（L0 `@zhizhang/core`）

- **零依赖 Schema 真源**（`schema/`）：`Parser<T>` 组合子支持 `desc()`、`nullable()`、`unknownValue` 与 `toJsonSchema()`；`defineTool()` 自动派生工具参数 Schema；全仓所有持久化文件与跨进程输出均经 Schema 解析。
- **文件系统、锁与意图日志**（`fs/`、`lock/`、`journal/`）：
  - `atomicWrite` 采用同目录临时文件 + `rename`（可选 `mode` 如密钥文件 `0o600`）；`resolveInside` / `resolveInsideAsync` 校验真实符号链接边界，防止路径穿越。
  - `LockService` 整合跨进程租约（`lease.json`）、按 `resource.kind` 命名空间隔离的可重入文件写锁（支持 `EPERM` 存活判定与 `LockOwnerSchema` 校验）与进程内 `createSerialRunner` 串行队列。
  - `commitIntent` 先写意图日志再逐文件原子落盘，崩溃重启时由 `replayPendingIntents` 按哈希校验补写未完成提交。
- **流水线引擎与上下文包**（`pipeline/`、`methods/`）：
  - `executePipeline` 通过 `persistChain` 串行化 `fanOut` 并发步骤的状态落盘，发射 `PipelineEvent`（`stage.start` / `stage.done` / `stage.failed`），并依据 `signal.reason` 精确区分 `paused` 与 `cancelled`。
  - `ContextPacket` 统一组织 prefix/suffix 分块、token 估算与裁剪审计 `omitted[]`。
  - `stage-map.ts` 按 `profiles/default/stage-map.json` 及 `when` 条件确定性直取方法文档原文并附内容哈希。
- **模型网关与 PI 隔离**（`model/`、`session/pi-adapter.ts`）：
  - `ModelGateway` 统一管理全局与单任务并发闸、token/金额预算预占、2s/6s/15s 指数退避、流式看门狗与 `UsageTracker` 记账，覆盖流水线 `run()` 与会话 `session()` 两条路径。
  - `pi-adapter.ts` 是唯一依赖 `@earendil-works/pi-*` 的边界模块：关闭 SDK 内置重试、采用 LRU 运行时缓存、`structuredClone` 克隆工具参数、优先按结构化 HTTP 状态码映射错误，并为连接测试强制 15s 超时。
- **Python 跨进程协议**（`python/`）：
  - `runPython` 以 `Buffer[]` 收集标准输出/错误流并在结束时整体 UTF-8 解码，避免中文多字节字符跨块截断；默认注入 `PYTHONUTF8=1` 与 `PYTHONIOENCODING=utf-8`；强制 30s 超时、4 MiB 输出上限与 `AbortSignal` 取消传播。
  - `runPythonJson` 强制通过 `Parser<T>` 校验 Python 返回的 JSON 契约。

## 4. 状态机与会话并发

- **运行记录状态机**（`RunRecord.state`）：`queued` → `running` → `paused`（暂停/预算触发/崩溃恢复）| `awaiting-author`（交付待作者决定）| `failed`；终态为 `applied` / `discarded` / `cancelled`。`RunStore` 隔离损坏 JSON 并按单目标 200 条终态记录自动裁剪。
- **助手会话并发**（`session/manager.ts`）：
  - `send` / `newConversation` / `compact` / `view` 按目标键串行化，根除快速连点竞态；
  - 内存态 `states` 映射受 16 槽 LRU 上限约束（不淘汰忙碌会话）；
  - 连续声明 `readonly: true` 的工具调用自动合并为并发批次执行，写操作工具保持顺序执行；单次工具输出超过 24,000 字符自动截断并附省略提示。

## 5. 磁盘格式（`zhizhang/2.0`）

统一使用 `FORMAT_VERSION = "zhizhang/2.0"`，不兼容 1.x 旧结构：

- **应用状态目录**（`~/.zhizhang/` 或 `ZHIZHANG_STATE_ROOT`）：
  - `settings.json`（经 `parseSettings` 校验，写操作串行化）
  - `secrets.bin`（`0600` 权限，仅当系统密钥库可用时加密落盘）
  - `runs/<mode>-<hash>/<runId>.json`、`sessions/`、`profiles/`、`logs/main.log`（去敏滚动日志）
- **本地写作文件夹**：
  - `.zhizhang/`：`lease.json`、`.zhizhang-lock/`、`drafts/`（工作台未保存草稿原子落盘）、`trash/`
  - `长篇/<book>/`：`work.json`、`bible/`（`entities`/`states`/`threads`/`knowledge`/`chapters`/`style`/`pending`/`index.json`）、`plan/`（含 `proposals/<runId>/`）、`chapters/`、`candidates/`
  - `头条/<article>/`：`meta.json`、`sources/`、`drafts/`、`qa/`、`.tmp/`（质检临时目录，用后清理）、`delivery.md`、`ledger.csv`
