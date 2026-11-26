# 系统架构与工程规范

本文档描述织章（Zhizhang）的模块分层、运行机制、视觉令牌、测试架构与工程守卫规范，作为仓库唯一的技术架构参考。

## 1. Monorepo 分层与依赖边界

织章采用单向依赖的 npm workspace 分层架构，所有跨包导入必须经 `package.json` `exports` 门面，禁止深层引用 `packages/*/src/*`：

```text
L3  apps/desktop (@zhizhang/desktop)
      ├── main/       共享组合根（app-runtime）、宿主抽象（platform）、命令分发与 IPC 处理器
      ├── server/     Web 预览宿主（0.0.0.0:3000 HTTP RPC + SSE + 示例工作区初始化）
      ├── session/    PI 会话引擎（仅 pi-adapter.ts 导入 @earendil-works/pi-*）
      └── renderer/   柔和纸面 C2 React 渲染层（IPC / HTTP-SSE 自动桥接）
         │
L2.5 packages/workbench (@zhizhang/workbench)
      └── 跨模式 50 条强类型命令契约（contract/）、稿纸阅读与源码编辑器、原子草稿暂存
         │
L2  packages/fanqie (@zhizhang/fanqie)    packages/toutiao (@zhizhang/toutiao)
      └── 番茄长篇领域、设定集、上下文、       └── 头条图文领域、Python 规则桥、
          流水线、命令、只读工具与视图            文章流水线、命令、只读工具与视图
      （两业务模式严格隔离，严禁互相依赖）
         │                                       │
L1  packages/ui (@zhizhang/ui)
      └── 三层 CSS 令牌（palette / semantic / component）、纯 React 无障碍原语、
          状态词语义与唯一中文文案源（copy/）（严禁依赖业务模式或应用包）
         │
L0  packages/core (@zhizhang/core)
      └── 纯机制层：零外部依赖，仅允许 node:* 与包内相对导入，严禁出现业务模式词汇
          （clock / errors / schema / fs / lock / journal / tool / pipeline /
            model / methods / python / paths / version）
```

## 2. 核心工程机制

### 2.1 统一错误模型与边界校验
- 全仓统一使用 `AppError` 与结构化错误码表（`packages/core/src/errors/codes.ts`），`packages/*/src/`、`apps/desktop/src/main/` 与 `apps/desktop/src/server/` 禁止裸 `throw new Error(`。
- 磁盘文件、IPC/RPC 参数、Python 子进程输出与模型结构化响应均须经 `@zhizhang/core/schema` 的 `Parser` 校验，禁止裸 `JSON.parse(...) as T`；同一 Schema 通过 `toJsonSchema()` 同步推导工具参数 JSON Schema。
- 错误分类通过结构化状态码与 `classify()` 完成，禁止通过正则匹配中文错误文案推导错误码。

### 2.2 双宿主共享组合根
- **宿主抽象**（`apps/desktop/src/main/platform.ts`）：收敛文件选择、打开路径、剪贴板与密钥加解密能力；Electron 宿主使用原生对话框与 `safeStorage`，Web 宿主降级为沙箱导出与内存态密钥（绝不落盘明文）。
- **传输无关 RPC**（`apps/desktop/src/main/ipc/handlers.ts`）：统一承载全部通道分发、只读模式写命令门禁与 Schema 参数解析。Electron 经 `ipcMain.handle("zhizhang:<channel>")` 暴露，Web 经 `POST /api/rpc/<channel>` + `GET /api/events`（SSE）暴露；渲染层通过 `apps/desktop/src/renderer/state/desktop.ts` 自动识别运行宿主。
- **Web 预览安全边界**（`apps/desktop/src/server/{web-server,http-io}.ts`）：默认监听 `0.0.0.0:3000`；所有 `POST /api/rpc/*` 强制校验同源 `Origin` 与 `application/json`；静态文件与 `/api/exports/:file` 全部走 `resolveInsideAsync` 路径沙箱；输出基础安全响应头且不阻断 iframe 预览。

### 2.3 磁盘格式、并发锁与原子意图
- 统一磁盘格式为 `FORMAT_VERSION = "zhizhang/2.0"`（定义于 `packages/core/src/version.ts`），遇到无法识别的格式统一抛出 `storage.format_unsupported`。
- **单文件写入**：统一经 `atomicWrite`（写临时文件 → 刷盘 → 原子重命名），密钥文件强制 `0o600` 权限。
- **跨文件变更**：设定集提交、全书规划晋升、候选采纳、旧书批量导入与头条交稿均经 `LockService` 加锁并走 `commitIntent` 意图日志：写锁内校验 `beforeHash` 防静默覆盖，启动或手动恢复时通过 `replayIntents` 在 `allowedRoots` 沙箱与写锁保护下回放未完成意图。
- **工作区单写者保护**：跨进程租约（`.zhizhang/lease.json`）防止多实例并发写入同一写作文件夹；只读窗口允许查阅但拦截全部写操作，作者确认后可主动接管。

### 2.4 流水线引擎、预算与模型网关
- **阶段隔离与恢复**（`packages/core/src/pipeline/`）：每次模型调用只看当前阶段必需的预算化 `ContextPacket`；`StageRunner` 支持 `fanOut` 并发分支并串行合并状态、落盘检查点与发射 `PipelineEvent`；支持暂停、取消与异常退出后的断点恢复。
- **并发预算保护**（`BudgetGuard`）：同时守卫单阶段输入上限（`inputBudget`）、单任务总 token 上限（`runBudget`）与金额上限（`moneyCap`），在途并发请求预留预估 token 与金额并在结算或失败时精确回退。
- **运行记录存储**（`RunStore`）：按目标隔离保存运行记录，损坏 JSON 自动隔离跳过不拖垮列表，终态历史按上限自动裁剪。

### 2.5 Python 跨进程桥接协议
- 所有 Python 脚本调用统一经 `@zhizhang/core/python` 的 `runPython` / `runPythonScript` / `runPythonJson`：强制注入 `PYTHONUTF8=1` 与 `PYTHONIOENCODING=utf-8`，以 `Buffer[]` 拼接 stdout 彻底杜绝多字节 UTF-8 跨 chunk 乱码，默认 30 秒超时、4 MiB 输出上限与 `AbortSignal` 传播；禁止内联拼接 `python -c`。

### 2.6 PI 只读助手会话内核
- SDK 严格隔离在 `apps/desktop/src/session/pi-adapter.ts`（纯辅助函数拆分在 `pi-helpers.ts`）。
- `SessionManager` 按目标串行化 `send` / `compact` / `newConversation` / `view`；对连续 `readonly: true` 工具由 `turn-runner.ts` 自动并发批处理，非只读工具保持串行；单次工具返回超长自动截断至安全上限。
- 写作助手（`assistant` 角色）严格遵守**作者是裁判**原则：只拥有只读查阅工具与“发起流水线 / 打开视图”导航工具，严禁直接修改正文或设定集。

## 3. 柔和纸面 C2 视觉与前端纪律

- **三层 CSS 令牌**：颜色字面量只允许出现在 `packages/ui/src/tokens/palette.css`；`semantic.css` 映射为 `--zz-*` 语义变量（支持 `[data-theme="day"]` 晨纸与 `[data-theme="night"]` 暗纸）；`component.css` 定义组件级令牌。非令牌 CSS 禁止原始十六进制色与旧前缀变量。
- **一色一意**：
  - `--zz-decide`（赭橙）：严格仅用于“需要作者裁决”的提示、圆点与主按钮；
  - `--zz-run`（蓝）：仅用于机器运行态；
  - `--zz-ok` / `--zz-bad`（绿 / 红）：用于增删差异与通过/失败；
  - `--zz-warn`（琥珀）：用于存稿缺口、过时分支与存储健康等提醒。
- **零硬编码文案与轻量化原语**：所有 `.tsx` 禁止出现 JSX 中文硬编码，文案统一收口至 `@zhizhang/ui/copy`；基础交互基于 `@zhizhang/ui/primitives` 自研纯 React 无障碍组件与 `lucide-react` 图标，不引入 Tailwind 或重型 UI 组件库；思源宋体通过 `@fontsource/noto-serif-sc` 本地离线打包，零外链字体请求。

## 4. 测试架构

测试脚本由 `scripts/run-tests.mjs` 自动发现并按分层执行：

| 测试目录 | 归层职责 | 覆盖范围 |
| --- | --- | --- |
| `test/unit/*.test.mjs` | 纯函数、契约与领域模型单元测试 | 工作区契约与版本对齐、Schema/工具/方法路由/Python 执行器、预算与并发金额预留、状态机与门禁、错误分类、内容解码与原子草稿、番茄上下文与设定集审计、番茄续写/存稿/旧书解析、头条状态/规则/事实核验、段落 diff 与对照、仪表盘与阅读状态、PI 辅助逻辑、C2 令牌 |
| `test/engine/*.test.mjs` | 文件系统、并发、流水线与双宿主集成测试 | 原子写入与意图回放、写锁服务、设定集存储与原子提交、流水线 `fanOut` 与 RPC 分发、运行时服务（`RunStore`、`ConfigService`、会话并发、Web 预览安全）、桌面 50 条命令与设置、助手只读工具边界、番茄全流程（规划/续写/去 AI 腔/衍生谱系/三分类沉淀/记账/回查/旧书导入）、头条规则桥与交稿幂等 |
| `packages/{toutiao,fanqie}/skill/tests/` | Python `unittest` | 头条规则算法、硬闸/评分、台账与桥接 JSON 契约；番茄测绘扫描与引文核验脚本 |
| `test/desktop/` | Playwright Electron E2E | 桌面冷启动、引导、三栏工作台、流水线对照采纳、助手会话与可访问性检查 |

测试纪律：禁止真实 `sleep` 轮询（统一注入 `test/support/clock.mjs` 与 `test/support/fake-port.mjs`），所有业务行为通过公开导出或 `executeTool` / `executePipeline` 验证。

## 5. 静态守卫（`scripts/guard.mjs`）

`npm run check` 依次执行 `tsc -b`、`eslint .`、`prettier --check .` 与 `node scripts/guard.mjs`，后者强制检查：

- **`[G-core]`**：`@zhizhang/core` 仅导入 `node:*` 与包内相对路径，严禁出现 `fanqie` / `toutiao`。
- **`[G-layer]` / `[G-facade]`**：`fanqie` 与 `toutiao` 严格隔离；`@zhizhang/ui` 不依赖业务模式或应用包；禁止深层 `packages/*/src/*` 导入。
- **`[G-app]` / `[G-pi]`**：`session/` 与 `renderer/` 禁止导入 `main/`；`@earendil-works/pi-*` 仅允许出现在 `session/pi-adapter.ts`。
- **`[G-type]` / `[G-error]` / `[G-exports]`**：`any = 0`、`! = 0`、`!: = 0`、`as` 受 `scripts/any-baseline.json` 约束只减不增；核心与服务端裸 `throw new Error(` 为 `0`；非 barrel 死导出 `unusedExports = 0`。
- **`[G-size]`**：单个 `.ts` / `.tsx` / `.css` 文件严格不超过 400 行。
- **`[G-copy]` / `[G-css]` / `[G-rules]` / `[G-docs]` / `[G-brand]`**：零 JSX 中文硬编码、TS 侧禁止重复定义 `84`/`34`/状态词表、非令牌 CSS 禁十六进制色、`rules.py` 规则真源完整、核心文档数 ≤ 6 份、无遗留品牌标识。
