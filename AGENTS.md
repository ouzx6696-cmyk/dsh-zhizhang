# 织章（Zhizhang）工程协作与开发规范

本文件是仓库的唯一工程协作宪法，面向所有贡献者与编码代理生效。任何改动都必须遵守以下红线、分层契约与验证口径。

## 1. 不可逾越的红线

### 1.1 核心业务规则红线
未经作者明确书面授权，**严禁修改**以下核心业务规则：
- **头条标题上限**：严格 `≤ 34` 字（唯一真源：[packages/toutiao/skill/scripts/rules.py](packages/toutiao/skill/scripts/rules.py) `TITLE_MAX`）。
- **头条质检及格线**：`PASS_SCORE = 84` 分且零 fail、无硬闸（唯一真源：`rules.py`）。
- **编辑打回上限**：番茄审读修订、头条精修均不超过 `2` 轮（`MAX_EDITOR_REJECTIONS = 2`）。
- **头条交稿固定末句**：“`——AI 到此止步。是否采用、何时发布由你决定。`”（[packages/toutiao/src/domain/status.ts](packages/toutiao/src/domain/status.ts)）。
- **状态词表**：
  - 番茄章节：`planned` / `drafting` / `drafted` / `reviewed` / `final`。
  - 头条文章：`初稿待改` / `待验收` / `已验收` / `验收退回` / `已交稿`。
- **作者是裁判**：所有正文采纳、定稿、设定集落盘、全书规划应用与头条交稿确认必须由作者显式触发；写作助手（`assistant` 角色）禁止拥有任何直接修改正文或设定集的工具。

### 1.2 资产、磁盘格式与零兼容红线
- 统一磁盘格式为 `FORMAT_VERSION = "zhizhang/2.0"`（定义于 [packages/core/src/version.ts](packages/core/src/version.ts)）。
- **严禁留存任何 1.x 旧格式或已退役实验开关的兼容分支**；遇到无法识别的磁盘格式统一抛出 `storage.format_unsupported`。
- **严禁在 TS 侧重复定义 Python 规则常量**（如 `84`、`34` 或开头/结尾式列表）；TS 侧一律通过 `writer_bridge.py` 获取并由 `runPythonJson` 做 Schema 校验。

### 1.3 分层与依赖边界（由 `scripts/guard.mjs` 强制门禁）
- **L0 `@zhizhang/core`**（`[G-core]`）：只允许导入 `node:` 内置模块与包内相对路径，**严禁出现 `fanqie`/`toutiao` 业务词**。
- **L2 业务模式隔离**（`[G-layer]`）：`@zhizhang/fanqie` 与 `@zhizhang/toutiao` 严禁互相引用；层只能向下依赖。
- **门面导出约束**（`[G-facade]`）：跨包一律经 `package.json` `exports` 子路径导入，禁止深层引用 `packages/*/src/*`。
- **桌面分层隔离**（`[G-app]` / `[G-pi]`）：`apps/desktop/src/session/` 与 `renderer/` 严禁导入 `main/`；`@earendil-works/pi-*` 只允许出现在 [apps/desktop/src/session/pi-adapter.ts](apps/desktop/src/session/pi-adapter.ts)。
- **文档数量上限**（`[G-docs]`）：`docs/` 下与仓库根（`README.md`、`AGENTS.md`、`CHANGELOG.md`）的 Markdown 文档总数不得超过 **8 份**。

### 1.4 费用与发版红线
- 未经作者明确书面批准，不得调用任何付费模型、不得变更发版流程或执行自动发布。

## 2. 工程代码规范

### 2.1 错误模型与边界校验
- 全仓统一使用 `AppError` + `CODES` 码表（[packages/core/src/errors/codes.ts](packages/core/src/errors/codes.ts)）。
- **禁止在 `packages/*/src/`、`apps/desktop/src/main/` 与 `apps/desktop/src/server/` 中使用裸 `throw new Error(`**（`[G-error]` 基线为 `0`）。
- 禁止通过正则匹配中文错误文案来推导错误码；在系统/网络/模型边界统一使用结构化状态码与 `classify()`。
- 所有从磁盘或跨进程边界读入的 JSON 数据，均须经过 `@zhizhang/core/schema` 的 `Parser` 校验，禁止裸 `JSON.parse(...) as T`。

### 2.2 类型安全、模块体积与文案纪律
- **类型安全**（`[G-type]`）：全仓 `tsc -b` strict 零错误；`any = 0`；非空断言 `! = 0`；确定赋值断言 `!: = 0`；`as` 类型断言数受 [scripts/any-baseline.json](scripts/any-baseline.json) 约束只减不增。
- **零死导出**（`[G-exports]`）：非 barrel 导出须全部被代码或测试引用（`unusedExports = 0`）。
- **模块内聚**（`[G-size]`）：单个 `.ts` / `.tsx` / `.css` 文件不超过 **400 行**，超出应按职责拆分（如 `schemas.ts` / `stages.ts` / `rules.ts` / `index.ts`）。
- **文案与样式**（`[G-copy]` / `[G-css]`）：所有 `.tsx` 禁止 JSX 中文硬编码，文案统一收口至 `@zhizhang/ui/copy`；非令牌 CSS 禁止十六进制颜色字面量与旧前缀 `--ui-`/`--wb-`。

### 2.3 并发、存储与安全边界
- **写锁与原子落盘**：单文件写入统一使用 `atomicWrite`（密钥文件须带 `{ mode: 0o600 }`）；跨文件变更（如设定集提交、全书规划晋升、头条交稿）必须经 `LockService` 加锁并走 `commitIntent` 意图日志。
- **路径沙箱**：凡外部/IPC/HTTP 传入路径均须经 `resolveInside` / `resolveInsideAsync` 或 `workspace.assertInside` 约束在允许根目录内。
- **双宿主 Web 预览安全**：`apps/desktop/src/server/web-server.ts` 默认监听 `0.0.0.0:3000`；所有 `POST /api/rpc/*` 必须校验同源 `Origin` 与 `application/json`；静态文件与 `/api/exports/:file` 必须走 `resolveInsideAsync` 沙箱；禁止输出阻断 iframe 预览的 `X-Frame-Options`。
- **Python 跨进程协议**：所有 Python 调用必须走 `runPython` / `runPythonJson`（UTF-8 `Buffer` 拼接 + `PYTHONUTF8=1` + 30s 超时 + 4 MiB 输出上限 + `AbortSignal` 传播），禁止内联拼接 `python -c`。
- **助手工具并发**：无副作用只读工具标记 `readonly: true`（由 `SessionManager` 自动并发批处理），写操作/流水线触发工具保持串行，单次工具输出自动裁剪至安全上限。

## 3. 测试规范与分层矩阵

- **归层原则**：
  - `test/unit/*.test.mjs`：纯函数、Schema、规则计算、上下文预算、编码与文本提取、UI 状态机。
  - `test/engine/*.test.mjs`：文件系统、锁、意图日志、设定集、流水线编排、Python 桥接调用与错误映射、会话管理、双宿主 HTTP/SSE 服务器与安全边界。
  - `packages/toutiao/skill/tests/` & `packages/fanqie/skill/tests/`：Python `unittest`，验证规则算法与 JSON 契约（TS 侧不重复断言评分算法细节）。
  - `test/desktop/`：Playwright 端到端旅程测试。
- **测试纪律**：
  - 只经公开导出、`executeTool`、`executePipeline`（配合 [test/support/fake-port.mjs](test/support/fake-port.mjs)）进入。
  - 禁止真实 `sleep` 与脆弱超时等待，统一注入 [test/support/clock.mjs](test/support/clock.mjs)。
  - 用例命名遵循“什么情况下 → 可观察结果”，不写工单号，不写已删除 1.x 旧格式兼容测试。

## 4. 交付与验证命令

| 命令 | 职责 | 目标耗时 |
| --- | --- | --- |
| `npm run check` | 依次执行 `tsc -b`、`eslint .`、`prettier --check .`、`node scripts/guard.mjs` | ≤ 60 s |
| `npm test` | 执行头条/番茄 Python `unittest` 与全部 Node `test/unit` + `test/engine` | ≤ 90 s |
| `npm run assets -- check` | 校验 `assets/manifest.json`、版本登记与各模式 `stage-map.json` 引用完整性 | ≤ 5 s |
| `npm run build` | 构建全仓 TypeScript 包与 Web 预览前端产物（`apps/desktop/out/web`） | ≤ 30 s |
| `npm run dev` | 启动 Web 预览服务（`0.0.0.0:3000`，热加载前端 + 共享组合根 RPC/SSE） | 常驻 |
| `npm run test:e2e` | 构建 Electron 桌面端并运行 Playwright 端到端旅程测试 | ≤ 4 min |
| `npm run release:verify` | 仅限 Windows：准备随包 Python、`electron-builder` 打包与交付冒烟校验 | Windows |

## 5. 仓库目录地图

- `packages/core`：L0 纯机制层（`clock` / `errors` / `schema` / `fs` / `lock` / `journal` / `tool` / `pipeline` / `model` / `methods` / `python` / `paths` / `version`）
- `packages/ui`：L1 设计令牌（`--zz-*`）、基础原语组件、状态词语义与 `DESKTOP_COPY` / `WORKBENCH_COPY` / `ERROR_COPY` 唯一文案源
- `packages/workbench`：L1 44 条强类型命令契约（`WorkbenchCommandMap`）、稿纸阅读与 `TextSurface` 源码编辑器、草稿原子持久化
- `packages/fanqie`：L2 番茄长篇模式（`domain` / `bible` / `storage` / `context` / `learning` / `pipelines` / `commands` / `tools` / `view` / `profiles` / `skill`）
- `packages/toutiao`：L2 头条图文模式（`domain` / `storage` / `rules` / `pipelines` / `commands` / `tools` / `view` / `profiles` / `skill`）
- `apps/desktop`：L3 共享组合根（`main/app-runtime.ts`）、宿主抽象（`main/platform.ts`）、Electron 主进程（`main/index.ts`）、Web 预览服务（`server/web-server.ts`）、PI 适配器（`session/pi-adapter.ts`）、会话管理（`session/manager.ts`）与 React 渲染层（`renderer/`）
- `assets/`、`scripts/`、`test/`、`docs/`：内置资产清单、守卫/备份/打包脚本、自动化测试与 8 份核心文档
