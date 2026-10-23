# 测试说明 · dsh-zhizhang 0.17.0

> 加测纪律也写在 [CHANGE.md](./CHANGE.md)。认知入口：[COGNITION.md](./COGNITION.md)。

> **本发行包不附 `test/`**（只带 `dist/` + `scripts/smoke.mjs`）。下面的分层是从源码仓
> 重建时的测试布局；在本包里请用 `npm run smoke`。

## 本包自检（smoke）

```bash
npm run smoke   # node ≥22；无 DSH / 无 bun
```

[scripts/smoke.mjs](../scripts/smoke.mjs) 覆盖：

- 按需挂载：`apply()` 只注册 `zhizhang_enable`、不注入硬规则 section；触发后 52 tools + 1 section；
  重复触发幂等；无 Agent 作用域返回 `no_agent_ctx`
- 本地书源：`sourceRoot` 解析进 paths；`listLocalBooks` 只收 `.txt/.md`；`library_list` 标已导入/未导入；
  `library_import` 用裸文件名从书源目录解析；面板 `/library` 带 `sourceRoot/pendingCount`
- 共享拆书库：`libraryRoot` 生效（工具写入共享根、项目库不进源）；面板 `/library` 读同一份
- 项目索引：工具调用登记工作区且不重复；`listProjects()` 摘要（works/chapters/words）现算；
  HTTP `/projects` 当前项目、`?base=<已登记>`可读、未知 `?base=` → `400 bad_base`
- 52 个工具命名唯一、`applyTools()` 全部注册
- 默认写作链：`project_create → outline_set → chapter_brief → candidate_stage →
  style_lint → candidate_accept`
- 硬闸：未 lint 拒绝、双采纳拒绝、面板 POST 缺 `confirm` 拒绝
- 沙箱：`chapter`/`candidate` id 目录穿越拒绝（工具与 HTTP）
- 面板 HTTP：`health` 版本、snapshot 默认无 HTML / `?html=1`、chapter、candidate、`bad_id`
- 拆书报告：固定 19 节、§1.1 量化底座 / §9.1 爽点密度、不泄漏 `Infinity`、v2 卡不误报「书感偏薄」
- 卡契约：v1 卡带 `steps/bannedDiction` 直接 `bad_args`（不再静默丢）、v2 `card_get` 渲染操作步骤/禁用词句
- 章号：中文「第一章」可被 plan 计数、批次取原文（`domain/chapter-heading.js`）
- 机械审计：无正文引文时输出「未发现声称原文的正文引文」，不再打印 `0/0`

## 源码仓分层（重建时）

| 层 | 目录 | 测什么 |
|----|------|--------|
| **产品闭环** | `test/contracts/product-loop.test.ts` | 同一句闭环、分喂纪律、ProductMap 交接、SYSTEM_BRIEF 硬点、version |
| **调度** | `test/contracts/scheduler.test.ts` 等 | 默认路径不含例行 audit；旁路表；工具 description 标签 |
| 契约 | `test/contracts/` | PortConfig、AcceptPolicy、**edit-port（A/B/C）**、MethodRegistry、QualityPolicy、brief-lean、前章正文 |
| 门禁 | `test/gates/` | HumanFeel（含 stiffness_tidy）/ NovelSense / Brief·Lint·Payoff·Save / linter |
| 支柱工序 | `test/pillars/` | Library / Inspiration / Writing 工序（仍属同一闭环） |
| 工具 | `test/tools/` | 注册烟测 + SYSTEM_BRIEF 硬点（不断言逐句文案） |

## 加测规则

1. **新能力 → 一条契约套件**，不是 N 条句子测试。  
2. 策略改动只落 `src/lib/ports/`；测试用 **hit code** / 硬拒 code，少绑中文长句。  
3. 金样正文放 `test/fixtures/`。  
4. 禁止为 SYSTEM_BRIEF / dissect 新加的一句单独开 `test()`。  
5. 端到端只保留一条全家桶路径；细节回 gates/contracts。  
6. **产品叙事变更**（闭环句、分喂、互指）优先落 `product-loop`，勿在 pillars 里重复粘贴长文断言。  
7. **调度变更**优先落 `scheduler`；工具 description 的【默认链】/【旁路】标签一并核对。

## 双轴 / combo / 反僵硬（仍有效）

- `pillars/library` · `inspiration` · `contracts/brief-lean`：axis / mind 准入 / forge 分喂 / lean 不灌 mind  
- combo：按书/按轴过滤与 `suggestCombo`（1 book + N scene）  
- `gates/human-feel`：`stiffness_tidy`（卡承诺打碎才扫；默认 warn）

## 命令（源码仓）

```bash
npm test          # node --test（无 bun 依赖）
npm run typecheck # tsc --noEmit
```

**测试运行方式（本轮起）**：套件从 `bun:test` 迁到 `node:test`，不再依赖 bun。
- `test/_compat/expect.ts`：bun/jest 风格 `expect` 的本地实现（只实现套件用到的匹配器）
- `test/_compat/ts-resolve.mjs`：把源码里的 `./x.js` 解析到 `./x.ts`（Node 不会像 bun 那样自动改写）
- `test/setup.ts`：用 `--import` 预载，隔离 `DSH_HOME`

本发行包只有：`npm run smoke`。

**状态隔离**：`npm test` 通过 `--import ./test/setup.ts` 预载，把 `DSH_HOME` 指向一次性临时目录。
工具调用会往 `$DSH_HOME/zhizhang-projects.json`（项目索引）与 `zhizhang-last-root.json`（HTTP 根标记）
写东西——不隔离的话每跑一次测试就往**真实** `~/.dsh` 里塞一批 Temp 工作区，还会把面板的根指到已删除的临时目录。
`scripts/smoke.mjs` 自己也会隔离，两处一致。

## 面板（0.17.0）

- `test/contracts/panel-ui.test.ts`：三柱 HTML、HTTP GET（snapshot/library/inspiration/**chapter/candidate**）、traversal 拒、snapshot 无 body、**accept POST**、client 席位 + **zz-workbench / zz-reader** 契约
- `test/contracts/panel-scheduler.test.ts`：nextHints 与 Scheduler 单源


## 多草稿（0.14）

`test/contracts/multi-draft.test.ts`：默认关拒绝 unify；开启后 brief→stage→lint→accept；Scheduler 默认 hint 无 unify。

## 类型护栏（本轮起）

```bash
npm run typecheck # tsc --noEmit，strict: true，0 错误；src 已无 @ts-nocheck
npm run guard     # 两条护栏，npm test 里也会跑（test/contracts/ts-guard.test.ts）
```

1. **@ts-nocheck 只减不增** —— `scripts/ts-nocheck-guard.mjs` 对照 `scripts/ts-nocheck-baseline.json`（现已清空）。
   往任何源文件加回 `@ts-nocheck` → 失败；清干净却没从基线删 → 也失败。
2. **类型不许当值 import** —— `scripts/type-import-guard.mjs`。Node 类型剥离只删注解、不删 import：
   `import { defineTool, ExecContext } from "./types.js"` 运行时就是
   `SyntaxError: does not provide an export named 'ExecContext'`，而 tsc 认为合法。
   类型一律写 `import type`。
