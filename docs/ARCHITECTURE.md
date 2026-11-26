# 系统架构（v2.3）

## 1. 分层依赖与架构守卫

```text
L3  apps/desktop          共享组合根(app-runtime) · 双宿主(Electron IPC + Web HTTP/SSE) · PI 会话引擎 · 柔和纸面 C2 渲染层
        │  仅经 package.json exports 门面导入
L2  @zhizhang/fanqie      @zhizhang/toutiao      ← 各自实现 ModeModule，严禁互引
        │
L1  @zhizhang/workbench   @zhizhang/ui           ← 50 条强类型命令契约、TextSurface、--zz-* 三层令牌与 CopyKey
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
| `G-type` / `G-exports` | `any = 0`、`! = 0`、`!: = 0`、`unusedExports = 0`、`as` 受 `any-baseline.json`（当前 `115`）约束只减不增；校验全部 `package.json` `exports` 存在 |
| `G-css` / `G-size` / `G-docs` | 非令牌 CSS 禁止十六进制色与旧前缀；单文件严格 `≤ 400` 行；核心文档总数 `≤ 8` 份 |

## 2. 双宿主运行态与传输无关 RPC

```text
                 ┌──────────────────────────┐
                 │  React Renderer (C2 UI)  │
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

- **宿主抽象**（[apps/desktop/src/main/platform.ts](apps/desktop/src/main/platform.ts)）：隔离原生目录/保存对话框、系统打开、剪贴板、系统密钥库（`safeStorage` / Web 内存回退）与独立进程离线备份。
- **共享组合根**（[apps/desktop/src/main/app-runtime.ts](apps/desktop/src/main/app-runtime.ts)）：装配 `ConfigService`、`WorkspaceService`、`ModelServices`、`RunStore`、`WorkflowService`、`SessionManager`、`StorageHealth` 与 `CommandCtx`，支持 `dispose()` 有序回收全部订阅、流水线、会话与租约锁。
- **Electron 主宿主与离线 CSP 合规**（[apps/desktop/src/main/index.ts](apps/desktop/src/main/index.ts)、`csp.ts`）：由 `register.ts` 将 `createRpcHandlers` 注册至 `ipcMain.handle`，`preload.ts` 仅暴露受控 `window.zhizhangBridge`；`index.html` 不包含任何外链字体请求，全部字体走本地打包 `@fontsource/noto-serif-sc` 与系统字体栈；`scripts/stage-desktop.mjs` 统一暂存前端产物与离线思源宋体许可文件（兼容根与工作区 hoisted `node_modules`）。
- **Web 预览宿主**（`apps/desktop/src/server/{web-server,http-io,seed}.ts`）：默认监听 `0.0.0.0:3000`，提供：
  - `GET /api/health`：运行态探活；
  - `POST /api/rpc/:channel`：强制同源 `Origin` 与 `application/json` 校验，25 MiB 请求体上限，白名单通道分派；
  - `GET /api/events`：SSE 事件流（25s 心跳 + `safeWriteSse` 断线清理，前端重连后自动同步工作区与运行状态）；
  - `GET /api/exports/:file` 与静态资源：经 `resolveInsideAsync` 沙箱约束，附带 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 与分层 `Cache-Control`。

## 3. 核心引擎机制（L0 `@zhizhang/core`）

- **零依赖 Schema 真源**（`schema/`）：`Parser<T>` 支持 `desc()`、`nullable()`、`unknownValue` 与 `toJsonSchema()`；`defineTool()` 自动推导工具参数 JSON Schema；所有磁盘 JSON 与跨进程输出均经 Schema 校验，零裸 `JSON.parse(...) as T`。
- **文件系统、写锁与原子意图日志**（`fs/`、`lock/`、`journal/`）：
  - `atomicWrite` 采用同目录临时文件 + `rename`（密钥文件附 `0o600`）；`resolveInside` / `resolveInsideAsync` 校验真实路径边界。
  - `LockService` 组合跨进程租约（`lease.json`）、按 `resource.kind` 隔离的可重入文件锁（含 `EPERM` 存活判定）与进程内 `createSerialRunner`。
  - `commitIntent` 在写锁内支持**前置 `beforeHash` 冲突校验**（发现目标文件被并发篡改即抛 `storage.conflict`），随后先落意图日志再逐文件原子提交；崩溃重启恢复时由 `replayPendingIntents` 结合 `allowedRoots` 路径沙箱与写锁安全补写，拒绝任何沙箱越界路径。
- **流水线引擎、并发预算与上下文包**（`pipeline/`、`model/`、`methods/`）：
  - `executePipeline` 通过串行落盘链管理 `fanOut` 并发阶段、广播 `PipelineEvent`（`stage.start` / `stage.done` / `stage.failed`），并基于 `signal.reason` 精确区分 `paused` 与 `cancelled`。
  - `BudgetGuard` 与 `ModelGateway` 除 token 并发预留外，同步执行**在途金额预留与结算（`reserveMoney` / `settleMoney`）**，避免并发起稿穿透单任务费用上限。
  - `ContextPacket` 统一管理分段预算、token 估算与裁剪审计 `omitted[]`；`stage-map.ts` 确定性直取方法文档原文并记录 SHA-256 哈希。
- **Python 跨进程协议**（`python/`）：`runPython` / `runPythonJson` 使用 `Buffer[]` 完整拼接后统一 UTF-8 解码，默认注入 `PYTHONUTF8=1` 与 `PYTHONIOENCODING=utf-8`，附带 30s 超时、4 MiB 输出上限、`AbortSignal` 传播与强制 Schema 校验。

## 4. PI 内核集成与只读会话引擎（`apps/desktop/src/session/`）

- **唯一 SDK 边界**（`pi-adapter.ts` + 纯辅助 `pi-helpers.ts`）：
  - 统一向流水线（`ModelPort`）与写作助手（`AssistantPort`）提供 `ModelRuntime.streamSimple` 能力，开启会话亲和（`sessionId`）与提示词缓存保留策略（`cacheRetention`）。
  - 关闭 SDK 内置重试（`maxRetries: 0`），全部退避与预算控制收归 `ModelGateway`；支持 `invalidatePiRuntime()` 在模型配置/密钥变更后立即刷新共享运行时，连接测试强制 15s 超时。
  - 利用 PI `validateToolArguments` 纠偏工具参数，`isContextOverflow` / `isRecoverableLength` 精确识别上下文溢出并触发自动压缩重试，`piModelCatalog` 暴露内置模型目录与思考档位能力。
- **只读会话引擎**（`manager.ts` + `turn-runner.ts` + `transcript.ts` + `compact.ts`）：
  - 按目标串行化 `send`/`compact`/`newConversation`/`view`，内存态保持 16 槽 LRU（不淘汰忙碌会话）。
  - 实时流式推送正文、思考链（`thinking_delta`）、缓存命中统计与上下文用量；断线孤立工具调用由 `repairOrphanedToolCalls` 自动修复。
  - 连续 `readonly: true` 工具自动并发批处理（含跨书实体时间线回查 `fanqie_trace_entity`），单次输出超过 24,000 字符自动截断；所有写正文/写设定集工具均不暴露给助手。

## 5. 柔和纸面 C2 前端架构（`@zhizhang/ui` + `apps/desktop/src/renderer/`）

- **三层设计令牌**：
  1. `packages/ui/src/tokens/palette.css`：全仓唯一颜色字面量源，定义浅色暖灰纸面与深色暗纸色阶。
  2. `packages/ui/src/tokens/semantic.css`：在 `[data-theme="day"]` / `[data-theme="night"]` 下映射为 `--zz-bg`、`--zz-paper`、`--zz-surface`、`--zz-surface-2`、`--zz-text-{1,2,3}`、`--zz-ink`、`--zz-border`、`--zz-decide`、`--zz-run`、`--zz-ok`、`--zz-bad`、`--zz-warn` 及 `color-mix` 派生的软底色与阴影。
  3. `packages/ui/src/tokens/component.css`：按钮四态（`decide` / `soft` / `ghost` / `text`）、圆角（8/12/18，按钮 10）、动效（`180ms cubic-bezier(.2,.8,.2,1)`）与无障碍焦点环。
- **无顶栏三栏布局与模块化渲染层**：
  - **左栏**（`topbar/{LeftRail,LeftRailParts}.tsx` + `styles/shell-rail.css`）：240px 平铺于 `--zz-bg`，承载品牌/日夜主题、模式分段控件、Ctrl+K 检索、作品/文章切换、章节列表、资料入口（含设定集待确认徽标）、新流水线按钮与静默保存状态。
  - **中栏**（`CenterBar.tsx` + `workspace/{Studio,StudioDashboard,FanqieWorkspace,ToutiaoWorkspace,ToutiaoLedger}.tsx` + `workflow/{DraftCompare,CompareSheets}.tsx`）：面包屑、单稿/对照切换、专注模式（`Ctrl+.`）、D3 创作内核仪表盘与连载存稿缓冲栏、浮起衬线稿纸、候选稿决策卡与并排双稿纸逐处采纳。
  - **右栏**（`workspace/RightDock.tsx` + `workflow/{WorkflowPanel,WorkflowStartForm}.tsx` + `agent/AgentPanel.tsx`）：344px 双浮卡容器，宽屏默认上下同屏展示 7 段流水线卡（含半章续写、黄金章、前章候选分支与专项去 AI 腔/轻润色入口）与只读助手卡（含原文引用定位卡），并可切至「本章/设定集」视图。
  - **专项视图**：`ProjectHub`（项目总览）、`NewTargetDialog`（新建长篇 / 导入旧书接管含切章预览 / 新建头条）、`BibleCenter` + `BibleCenterTabs`（含「时间线回查」页签）、`TechniqueWarehouse` + `TechniqueEditor`（技法仓库与交互式 Markdown 预览）、`SettingsDialog`（模型/引擎/外观/写作文件夹/关于）。

## 6. 磁盘格式（`zhizhang/2.0`）

统一使用 `FORMAT_VERSION = "zhizhang/2.0"`，遇旧格式统一抛出 `storage.format_unsupported`：

- **应用状态目录**（`~/.zhizhang/` 或 `ZHIZHANG_STATE_ROOT`）：`settings.json`、`secrets.bin`（`0600`）、`runs/<mode>-<hash>/<runId>.json`、`sessions/`、`profiles/`、`logs/main.log`。
- **本地写作文件夹**：
  - `.zhizhang/`：`lease.json`、`.zhizhang-lock/`、`intents/`、`drafts/`、`trash/`；
  - `长篇/<book>/`：`work.json`（含可选 `publishedThrough` / `dailyTargetChars`）、`bible/`（`entities`/`states`/`threads`/`knowledge`/`chapters`/`style`/`pending`/`index.json`）、`plan/`（含 `proposals/<runId>/`）、`chapters/`、`candidates/`（`.meta.json` 含 `derivedFrom` 与 `sourceHash`）、`sources/legacy-import/`（旧书接管原始字节无损备份与 `import-manifest.json`）；
  - `头条/<article>/`：`meta.json`（含 `acceptedRevision` / `deliveredRevision` 修订绑定）、`sources/`、`drafts/`、`qa/`、`.tmp/`、`delivery.md`、`ledger.csv`；
  - `拆书库/`：拆书来源与技法卡（支持前端交互式编辑与绑定）。
