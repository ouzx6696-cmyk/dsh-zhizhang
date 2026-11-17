# 系统架构

- **描述基线**：发布基线 master `83bf7f7`（v1.4 M0 修复线已合入；未发布、未推送）；集成分支 `integration/v1.4` 的代码合并点为 `1d9518a`（A-02 接口桩与契约测试 + D-02 设定集变更集，已合入、待审核），其后有文档同步提交
- **发布版本**：`v1.3.0`（`origin/master@20c150a`）
- 文档随代码基线更新；版本号只在发版时提升。

## 1. 分层与守卫规则

```text
L3  apps/desktop          组合根 · IPC · 窗口 · PI 适配 · 渲染层
        │  仅经 package.json exports 门面导入
L2  @zhizhang/fanqie      @zhizhang/toutiao      ← 各自实现 ModeModule，互不引用
        │
L1  @zhizhang/workbench   @zhizhang/ui           ← 命令契约、TextSurface、--zz-* 令牌与 CopyKey
        │
L0  @zhizhang/core        errors / schema / fs / lock / journal / tool / pipeline / model / methods / python / id / text
```

[scripts/guard.mjs](../scripts/guard.mjs) 统一执行 **14 条**静态守卫：

| 守卫 | 约束 |
| --- | --- |
| `G-layer` | 层只能向下依赖 |
| `G-facade` | 跨包只能走 `package.json` `exports`，禁止深入 `packages/*/src/` |
| `G-app` | `session/` 与 `renderer/` 不得导入 `main/` |
| `G-pi` | `@earendil-works/pi-*` 仅限 [pi-adapter.ts](../apps/desktop/src/session/pi-adapter.ts) |
| `G-core` | `core` 只导入 `node:` 内置模块，严禁出现 `fanqie`/`toutiao` 业务词 |
| `G-error` | `packages/*/src` 禁止新增裸 `throw new Error(`；`main/` 受基线约束只减不增 |
| `G-copy` | `desktop/renderer` 与 `ui` 的 JSX 禁止写中文，文案统一进 `CopyKey` |
| `G-rules` | `84` / `34` 仅存于 [rules.py](../packages/toutiao/skill/scripts/rules.py) |
| `G-type` | `any` ≤1、`!` = 0、`!:` = 0、`as` 受基线约束只减不增 |
| `G-exports` | 校验 `exports` 路径与零引用导出基线 |
| `G-brand` | 清单与新模块不得出现旧品牌标识 |
| `G-css` | 非令牌 CSS 禁止十六进制色与 `--ui-/--wb-` 变量 |
| `G-size` | 新文件 >400 行报错；遗留文件不许变长 |
| `G-docs` | `docs/` 与根文档合计 ≤8 份 |

补充门：[check-ratchet.mjs](../scripts/check-ratchet.mjs)（指标与基线比较，只减不增）与 [check-budget.mjs](../scripts/check-budget.mjs)（渲染分块与文件体积预算）。

## 2. 进程边界与 IPC

- **主进程组合根**（[main/index.ts](../apps/desktop/src/main/index.ts)）：构造并注入各服务，不持有全局可变 Runtime；注册 `ModeModule`、管理 `WorkflowService`（单活任务、断点指针）、分派 `WorkbenchCommandMap`（**68 条**，按 `commands.ts` + `commands-{outline,bible,import,ledger}.ts` 分组）、托管离线备份 utility process。
- **强类型契约**：渲染端经 [preload.ts](../apps/desktop/src/preload.ts) 暴露的 `window.zhizhangBridge` 调用 [shared/ipc.ts](../apps/desktop/src/shared/ipc.ts) 中的 `IpcMap`（**43 个通道**，每个以 `zhizhang:<id>` 注册、参数由主进程用 `core/schema` 解析），并接收 [shared/events.ts](../apps/desktop/src/shared/events.ts) 的判别联合 `DesktopEvent`。
- **导入令牌**：`dialog.pickImport` 只把一次性令牌交给渲染层；绝对路径留在主进程内存（10 分钟过期、用后即删，[main/ipc/import.ts](../apps/desktop/src/main/ipc/import.ts)）。
- **模型网关与 PI 隔离**：所有流水线阶段经 `ModelGateway`（全局并发闸默认 4、token 与金额预算、2s/6s/15s 退避、流式看门狗、无效回答计费）调用 `ModelPort`，不直接耦合 PI SDK；PI 仅由 `session/pi-adapter.ts` 引入。

## 3. 流水线与状态机

- **流水线运行状态**（`RunRecord.state`，[state.ts](../packages/core/src/pipeline/state.ts)）：`running` → `paused`（预算/金额/取消/人工暂停）| `failed` | `awaiting-author`（交付待确认）；`awaiting-author` 只能转 `applied` / `discarded`（作者裁决），`paused` / `failed` 可恢复为 `running`，`cancelled` 为终态。非法转移抛 `run.invalid_transition`。
- **注册流水线 9 条**：番茄 `fanqie.book`、`fanqie.chapter`、`fanqie.review`、`fanqie.revise`、`fanqie.ledger`、`fanqie.health`、`fanqie.import`（A-02 注册，阶段实现待 I-02）、`library.dissect`；头条 `toutiao.article`。
- **章节链路**：`prepare`（零费用预检）→ `beats` → `draft×N` → `gate`（字数与规则代码闸）→ `select-score` / `select-compare`（逐稿打分 + 前两名换位比较）→ `continuity-check` → `review`（≤2 轮）→ `revise` → `deliver`（幂等候选）。
- **头条链路**：`card` → `title` → `blueprint` → `draft` → 事实链核对 → `review` → `revise` → `qa` → `deliver`（交稿单）。
- **番茄章节状态**：`planned` → `drafting` → `drafted` → `reviewed` → `final`。
- **头条文章状态**：`初稿待改` → `待验收` → `已验收` / `验收退回` → `已交稿`（终态不可逆，仅由作者确认触发）。

## 4. 磁盘格式（`zhizhang/1.3`）

- **应用状态目录**（`~/.zhizhang/` 或 `ZHIZHANG_STATE_ROOT`）：`settings.json`、`secrets.bin`（加密密钥）、`logs/`、`sessions/`、`pi/auth.json`，以及 `runs/<mode>-<目标哈希>/<run-id>.json`（运行记录与断点恢复依据；不随作品备份）。
- **本地写作文件夹**：
  - `.zhizhang/`：`lease.json`（跨进程租约）、`.zhizhang-lock/`（可重入资源写锁）、`drafts/`（编辑草稿经 [main/ipc/drafts.ts](../apps/desktop/src/main/ipc/drafts.ts) 落盘，同 key 串行、最后一次生效；不再使用 `localStorage`）。
  - `长篇/<bookId>/`：`work.json`、`bible/`（`entities.json`、`timeline.json`、`states.json`、`threads.json`、`knowledge.json`、`style.json`、`ledger/<chapter-id>.json`、`pending/<batch-id>.json`、`changes/<YYYY-MM>.jsonl`、`index.json`（`files.<name>.{rev,hash}` + `lastLedgerChapter`））、`plan/`、`chapters/`、`candidates/`。旧 `chapters.json` / `pending.json` 不再读写。
  - `头条/<articleId>/`：`meta.json`（元数据与状态历史）、`sources/`、`drafts/`、`qa/`、`交稿单.md`。
  - `拆书库/`：拆书来源与参考卡片。
- **多文件提交**：所有跨文件写入通过 `LockService` 加锁，经 `atomicWrite` + `Intent` 意图日志原子落盘，并在启动时重放未完成意图；`atomicWrite` 对 `storage.locked` 做指数退避重试（约 10 秒）。设定集变更把真源全文、ledger、索引、待确认批次与 `changes/` 变更集行放进同一 Intent；撤销以变更集逆操作生成新的 `revert` 变更集。

## 5. 错误码与配置

- **错误码原则**：统一使用 `AppError` 与 `CODES`（[codes.ts](../packages/core/src/errors/codes.ts)），共 **23 个**，按 `input.*`、`gate.*`、`storage.*`、`model.*`、`budget.*`、`run.*`、`python.*`、`network.*`、`ipc.*` 分类，并在边界由 `classify()` 映射 errno 与 HTTP 状态。
- **配置模型**：全局设置由 [shared/settings.ts](../apps/desktop/src/shared/settings.ts) 统一 schema 校验，包含六角色模型卡（writer / editor / planner / judge / extractor / assistant，缺省按 `roles.ts` 回落）、引擎档位（经济 / 标准 / 精品）、token 与金额上限、全局并发数、外观（主题 / 字体 / 行长）与写作文件夹路径。

## 6. 契约规模（2026-11-17 实测）

| 契约 | 数量 | 位置 |
| --- | ---: | --- |
| 工作台命令 `WorkbenchCommandMap` | 68 | `packages/workbench/src/contract/commands.ts`（fanqie 43 / toutiao 12 / profiles 9 / library 4） |
| IPC 通道 `IpcMap` | 43 | `apps/desktop/src/shared/ipc.ts` |
| 错误码 `CODES` | 23 | `packages/core/src/errors/codes.ts` |
| 文案键 | 969 | `packages/ui/src/copy/*.ts`（15 个模块去重合计；`COPY` 聚合 810） |
| 注册流水线 | 9（番茄 8 + 头条 1） | 两个 `ModeModule` |
| `stage-map` 条目 | 19（番茄 11 + 头条 8） | `packages/*/profiles/default/stage-map.json` |
| 静态守卫 | 14 | `scripts/guard.mjs` |

## 7. 测试体系规范

- **分层**：L1 `test/unit/`（纯规则与契约，23 文件、139 项中的大部分）→ L2 `test/engine/`（持久化、锁、意图、设定集、流水线编排，13 文件）→ L3 桌面会话与 IPC（`test/desktop/`）→ L4 Playwright E2E（13 条旅程）；Python `unittest`（227 项）负责规则计算与质检，TS 仅测调用、错误映射与落盘。
- **夹具与纪律**：L2 流水线测试使用 [test/support/fake-port.mjs](../test/support/fake-port.mjs) 与 [test/support/clock.mjs](../test/support/clock.mjs)，禁止真实 `sleep` 与跨用例共享队列；不写任何 1.x 旧格式兼容测试。
- **门禁目标**：`check` ≤60 s（实测约 25 s）、`test` ≤90 s、`test:e2e` ≤4 min；Windows 与 Linux（xvfb）CI 双跑 E2E。

## 8. 文本机制（C-01a，待审核）

`@zhizhang/core/text` 已实现 `detectEncoding`、`normalize` 与 `segment`，不新增运行时依赖。编码检测依次检查 BOM、无 BOM UTF-16 零字节分布、全文件严格 UTF-8，再对前 64 KB 的 GB18030 / Big5 按简繁高频字、中文标点和替换字符打分；低分报 `input.invalid`（`reason: encoding_unsupported`）并带候选预览。预览最多 400 个 UTF-16 单元，不截断代理对。

规范化只清理约定不可见字符、换行和行尾空白，不做 NFKC；可选 `map` 按 UTF-16 单元回指输入偏移。分节返回相对于传入文本的半开区间及 SHA-256 前 12 位段落哈希；MD 支持 ATX / Setext / front matter / 表格与列表，TXT 按信号打分推断卷幕章。作者映射按标题样本文本精确匹配，`ignore` 优先。`matchKey`、`chunk`、`locateQuote` 仍为 C-01b 桩；导入 IPC 接线归 I-01。
