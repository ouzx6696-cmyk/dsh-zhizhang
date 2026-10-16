# 改进端口手册

> 认知入口：[COGNITION.md](./COGNITION.md) · 改动流程：[CHANGE.md](./CHANGE.md) · 调度图：[MAP.md](./MAP.md)

所有**策略与可演进行为**应落在 `src/lib/ports/`。工具（`src/tools/*`）只做参数校验、打开存储、调用端口、拼回执；`src/index.ts` 只 compose + `apply`。

---

## 总则

| 可以 | 不可以 |
|------|--------|
| 改 Port 实现或 `PortConfig` | 在工具 execute 里新写 if-硬闸 |
| 给 Gate 加可选 flag（默认软） | 把禁词命中默认升级为硬拒质量法 |
| 扩展 MethodRegistry 资产 id | 把整包方法灌进 `SYSTEM_BRIEF` |
| 经 Audit 端口换传感器实现 | 让 AI / bash 直写 `chapters/` / `library/cards/` |
| 扩展 Library / Inspiration 契约 | 用 foundation notes 假装技法卡已入库；静默 foundation_set |

契约类型：`GateDecision`（`ok` + `messages[]`，`ok===false` 须硬拒）。

---

## 支柱端口

### `port.library` — LibraryPort（**live**）

- **文件**：`src/lib/ports/library.ts`
- **契约**：`status: "live"`；`ensureLibrary` / `importSource` / `dissectBrief` / `stageCard` / `acceptCard` / `listCards` / `searchCards` / `suggestCombo` / `getCard`
- **落盘**：`.zhizhang/library/{sources,cards,candidates,index.json}`
- **卡契约（0.7+；0.8 叙事统合）**：硬字段 `axis: craft|mind`；craft→`humanFeel`+`bookCraft`；mind→`MindSpec`；`kind` 次标签；百科/声纹硬拒
- **0.7.1 产品面**：`listCards`/`searchCards` 可按 `sourceId`/`sourceIds`/`sourceTitle`/`axis` 过滤；`suggestCombo` → **1 mind + ≤N craft**（可跨书）`card_ids`
- **bookCraft**：`continueWhy` / `adjacentChange?` / `failAsShortStory?`；只迁「继续」过程，不抄情节链
- **反僵硬（craft）**：打碎逻辑 + 本书载体；`allowedEdges`「本场应落纸」；lean 可追加一行；`stiffness_tidy` 软雷达（卡承诺打碎才扫）
- **dissect**：人味 + **进入→兑现→为什么继续**；mechanisms 仍须 failWhen；只迁技巧不抄剧情
- **硬规则**：空 body 拒；stage 不写 `cards/`；须显式 accept 才入库
- **勿改**：与 MethodRegistry 方法包混为一谈；在写作闸里塞拆书

### `port.inspiration` — InspirationPort（**live**）

- **文件**：`src/lib/ports/inspiration.ts`
- **契约**：`startSession` / `forgeBrief` / `stageEmit` / `acceptEmit` / `getSession` / `listSessions`
- **落盘**：`.zhizhang/inspiration/{sessions,candidates}`
- **依赖**：选用卡须已 accept；**须至少一张 mind**（或 `craft_only`）；`card_ids` 可用 `library_combo_suggest`；forge：**mind 主粮 + craft 辅**；lean brief **只吃 craft**；禁止声纹教嘴
- **resolveCardsForBrief**：explicit cardIds → inspire apply 绑作品 → genre 检索；供 chapter_brief
- **硬规则**：`acceptEmit(apply=true)` 才调用 store foundation/outline；默认不静默写作品
- **勿改**：把灵感推演偷偷写成 `foundation_set` 旁路；只贴卡标题当注入


### `port.foundation` — FoundationPort（**live** · 0.3.6）

- **文件**：`src/lib/ports/foundation.ts`
- **契约**：`appendHappened(dir, {chapterId,text,title?})` 短追加 happened（`[chapterId]` 去重）；`acceptReceiptLines` 回执
- **调用**：`candidate_accept` 用 outline.ending 自动追加；工具 `zhizhang_foundation_append_happened` 精修
- **勿改**：从正文杜撰长篇 happened；与 NovelSenseGate 混为一谈

### `port.scheduler` — Scheduler（**live** · 0.10.5）

- **文件**：`src/lib/ports/scheduler.ts`
- **契约**：`defaultLine` / `writeLine` / `bypasses` / `nextHint` / `formatDiagram`；默认路径与旁路单源
- **消费者**：ProductMap、SYSTEM_BRIEF、renderStatus、project_create 回执、TOOLS
- **勿改**：在工具里另写一套「推荐链」绕过 Scheduler；把 diagnose.audit 写进默认路径

### `port.product` — ProductMap

- **文件**：`src/lib/ports/product.ts`
- **契约**：只读**一条创作闭环** + **Scheduler 调度图** + 三阶段 + MethodRegistry；`CREATIVE_LOOP_LINE` ≡ `Scheduler.defaultLine()`；`version` 与 package 对齐（0.10.5）
- **勿改**：把三阶段写成三个互不交接的产品；在地图里声明未实现能力为 live

---

## 质量面端口（live · 0.10.5）

- lean brief：`brief_mode` 默认 lean；卡 `formatTechniqueCardBlockLean`；方法默认仅 style_contract


### `port.quality` — QualityPolicy

- **文件**：`src/lib/ports/quality-policy.ts`
- **契约**：人味(`feel`)·书感·毒点·兑付·AI腔为**同一质量面**；轴 id 不用 `voice`；`poisonPolicy` / `poisonHint` 单源；`QUALITY_BOOK_DEBT_CUE_RE` 供 NovelSense（不含账本流水词）
- **消费者**：`formatReaderContract`、`library.dissectBrief`、`inspiration.forgeBrief`、NovelSenseGate、SYSTEM_BRIEF / ProductMap 表述
- **勿改**：拆成三套互不通信的「人味产品 / 书感产品 / 毒点产品」；把毒点写成禁词洗衣单；让书债线索奖励对账流水

---

## 写作门禁端口（live）

### `port.config` — PortConfig

- **文件**：`src/lib/ports/config.ts`
- **契约**：窗口与默认策略开关（brief、旁路字数、`defaultStrictLint`、`defaultRequirePayoff`、`defaultStrictHuman`）
- **勿改**：Store 路径约定；工具名

### `port.lint_gate` — LintGate

- **文件**：`src/lib/ports/lint-gate.ts`
- **契约**：token=已扫过；命中>0 默认 warn；`strictLint` → deny
- **勿改**：暗示 token=质量过关

### `port.brief_gate` — BriefGate

- **文件**：`src/lib/ports/brief-gate.ts`
- **契约**：无近期 brief 且未 skip → deny `brief_required`
- **勿改**：无 brief 时静默放行（除非 skip）

### `port.payoff_gate` — PayoffGate

- **文件**：`src/lib/ports/payoff-gate.ts`
- **契约**：默认软警告；`requirePayoff` 时硬拒
- **勿改**：把启发式审计当成剧情理解引擎

### `port.save_bypass_gate` — SaveBypassGate

- **文件**：`src/lib/ports/save-bypass-gate.ts`
- **契约**：大正文且无 `confirmBypass` → deny
- **勿改**：取消 ledger `chapter_save_direct` 留痕

### `port.accept_policy` — AcceptPolicy

- **文件**：`src/lib/ports/accept-policy.ts`
- **契约**：组合 Brief → Lint → Payoff → HumanFeel → NovelSense
- **勿改**：在工具里旁路组合器直接 accept

### `port.methods` — MethodRegistry

- **文件**：`src/lib/ports/methods.ts`（资产正文在 `method-assets.ts`）
- **契约**：`list` / `get` / `briefDefaultIds` / `resolveBriefAssets` / `formatReaderContract`
- **0.5.0 lean**：默认仅 **`style_contract`**；`brief_mode=full` 才带 novel_sense/draft/tomato；顶部仍拼「本书读者合同」（premise / planned / threads / 前章落点）
- **与卡分工**：书感=合同+前章后果（+full 时 novel_sense）；人味=技法卡 lean 写法+状态；方法包管流程；三者不混
- **勿改**：把方法资产与拆书库技法卡混为一谈；把书感长说教灌进 SYSTEM_BRIEF

### `port.human_feel_gate` — HumanFeelGate

- **文件**：`src/lib/ports/human-feel-gate.ts`
- **契约**：范文腔 + 毒点软雷达（过齐 / 任务句连排 / 器物清单 / **设定清单** / **记账流水** / **家长里短**）+ **`stiffness_tidy`**（卡承诺打碎才扫）；默认 warn；`strictHuman` → deny
- **勿改**：当作质量法或禁词洗衣单；默认硬拒；为每一句文案加微测；与 QualityPolicy 毒点政策分叉两套文案

### `port.novel_sense_gate` — NovelSenseGate（**live** · 0.3.7）

- **文件**：`src/lib/ports/novel-sense-gate.ts`
- **契约**：书感软雷达（同构再演示 / 无书债 / 过闭环）；默认 warn `novel_sense_hits`；`strictNovel` → deny；续写可对照 `prevBody`
- **勿改**：当作质量法；与人味闸默认叠硬拒；用对账流水词冒充书债成功（书债线索归 QualityPolicy；连续性用「当前小说状态」）

### `port.audit` — StyleLinterPort · PayoffAuditorPort · HumanFeelAuditorPort · NovelSenseAuditorPort

- **文件**：`src/lib/ports/audit.ts`
- **契约**：封装 style-linter / payoff-audit / human-feel / novel-sense 传感器
