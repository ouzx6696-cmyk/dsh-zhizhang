# 测试说明 · dsh-zhizhang

> 三层验收：**单测（能力面）· e2e（工作流面）· smoke（发行面）**。
> 加测纪律也写在 [CHANGE.md](./CHANGE.md)；认知入口：[COGNITION.md](./COGNITION.md)。

## 命令

```bash
npm test          # node --test · 9 套 / 68 用例（能力面，src 直跑）
npm run e2e       # 26 步真实创作剧本全链（拆书→灵感→写作→定稿→汇编→面板，跑 dist）
npm run smoke     # dist 加载面冒烟（51 工具注册 · 按需挂载 · 面板可服务 · 版本一致）
npm run typecheck # tsc --noEmit，strict 0 错误
npm run guard     # @ts-nocheck 只减不增 + 类型不许当值 import
```

## 三层各自管什么（不重复）

| 层 | 跑什么 | 不跑什么 |
|----|--------|----------|
| **单测 `test/*.test.ts`** | 每个能力一条套件：纯函数矩阵、闸语义、存储边界、管线各段、HTTP 面 | 不重复走完整故事（那是 e2e 的事） |
| **e2e `scripts/e2e-workflow.mjs`** | 一条连续剧本跑完整个创作闭环，双断言=真实落盘+回执指路 | 不逐字段钉文案（那是单测的事） |
| **smoke `scripts/smoke.mjs`** | 发行产物本身：dist 可加载、挂载模型、版本一致 | 不测任何功能链路 |

## 单测布局（一能力一文件）

| 文件 | 覆盖 |
|------|------|
| `domain.test.ts` | ending 一致性矛盾矩阵（payoff↔读者合同同向）、软雷达、卡 schema、章号、覆盖率权重 |
| `gates.test.ts` | Lint/Brief/Payoff/SaveBypass 原语、AcceptPolicy 组合（strict 三态/短路/编辑 A/B/C）、双采纳竞态 |
| `store.test.ts` | id 沙箱、ledger 上限、mtime 缓存失效、坏时间戳、快照字段上界/轻量模式、前章解析不静默回退、损坏章节不覆盖、并发候选 id、项目 worksRoot |
| `library.test.ts` | 拆书管线一条流（回执逐步指路）、v1/v2 卡准入、深检索 hay、Full 同意+参数绑定、卡候选只采纳一次、卡 id 沙箱、batch_chars 兜底、excerptPath 沙箱 |
| `inspiration.test.ts` | 会话/forge 分喂、根基章纲 apply、bindings 索引、取卡三路 |
| `writing.test.ts` | lean/full brief 契约、n≥2 前章注入、method_get 容错、交稿链→定稿→汇编、参数硬校验、确认旗标严格布尔（`"false"` 不算）、近期已采纳顺序 |
| `panel.test.ts` | HTTP 路由/快照上界、accept POST 语义（confirm/mode/严格布尔）、安全面（415/Origin/LAN/限流） |
| `multidraft.test.ts` | 默认关硬拒；开启后 unify 全链 |
| `infra.test.ts` | 挂载模型、51 工具面、Scheduler 单源、护栏基线 |

共享设施：`test/helpers.ts`（withStorage/withWork/servePanel/jpost）、`test/fixtures/`（金样正文）、
`test/_compat/`（expect 本地实现 + `.js→.ts` 解析钩）、`test/setup.ts`（DSH_HOME 隔离）。

## 加测规则

1. **新能力 → 在对应能力文件里加一条 test**，不开新文件、不复制样板。
2. 断言 **code / 落盘事实 / 回执指路**，少绑中文长句文案。
3. 行为矩阵（同一输入多处结论须同向）只钉在 `domain.test.ts` 一处。
4. 金样正文进 `fixtures/`；工作流级回归优先加进 e2e 剧本而不是单测。
5. 每条测试要能说出它防的是哪个真实回归（说不出就删）。

## 状态隔离

`npm test` 经 `--import ./test/setup.ts` 把 `DSH_HOME` 指向一次性临时目录——工具调用会写
`$DSH_HOME/zhizhang-projects.json` 与 `zhizhang-last-root.json`，不隔离会污染真实 `~/.dsh`。
smoke 与 e2e 各自隔离，口径一致。

## 类型护栏

```bash
npm run guard   # ts-guard 基线在 infra.test.ts 里也有钉子
```

1. **@ts-nocheck 只减不增**（`scripts/ts-nocheck-baseline.json` 已清空）。
2. **类型不许当值 import**（类型剥离只删注解不删 import，运行时即 SyntaxError；一律 `import type`）。
