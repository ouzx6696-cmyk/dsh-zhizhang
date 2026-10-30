---
title: 写作 Agent（基于 DeepSeek Harness）架构设计与实施方案
subtitle: 番茄长篇网文 × 今日头条图文 · v0.1 草案
date: 2026-10-28
---

# 0. 文档说明

| 项 | 内容 |
|---|---|
| 版本 | v0.1（草案，供评审） |
| 适用范围 | 基于 DeepSeek Harness（DSH）构建写作专用 Agent，首期覆盖番茄长篇网文、今日头条约 3000 字图文（含短图文、微头条） |
| 输入资产 | inspiration-forge-suite 1.3.0、dsh-zhizhang（织章）0.20.0、toutiao-viral-writer 4.0.0 |
| 约定 | 文中 DSH 扩展点（`ctx.tools`、`ctx.systemPrompt.section()`、`agent.inject()`、`tools/pre-execute`、`ctx.subagents`、agent preset、`ConversationNodeDefinition` 等）取自 DSH 官方 architecture 与 extension-cookbook 文档。DSH 处于 developer preview，具体签名以锁定版本的源码为准，M0 阶段逐一验证 |

# 1. 背景与目标

## 1.1 要解决的问题

现有三个包各自成熟，但还不是一个"产品"：

- 方法论（规划、拆书、正文、头条七步）以 Skill 形式存在，靠模型自己读文档、自己跑脚本，执行稳定性取决于模型自觉。
- 长篇有织章做存储与版本流，头条没有对应的工程层，只有 `outputs/toutiao/` 目录和 `log.csv`。
- 质检、台账、章纲检查等脚本是"建议去跑"，不是流程里的硬闸。
- 缺少统一入口：用户要先知道装哪个插件、启用哪个 Skill、说什么话。

## 1.2 目标

1. **一个入口，两种体裁**：用户打开即选「番茄长篇 / 头条图文」，后续只看到该体裁需要的规则、工具和界面。
2. **方法论变成可执行流程**：关键步骤由工具承载、由门禁把关，而不是靠提示词提醒。
3. **作者始终握有决定权**：采纳、定稿、交稿、发布都需要作者显式确认；Agent 不代发、不登录平台账号。
4. **本地优先、可恢复**：作品数据在本地，可备份、可回滚、可在换会话后恢复现场。
5. **随 DSH 升级而不被拖垮**：对 DSH 的依赖集中在一层适配代码。

## 1.3 非目标（首期不做）

- 自动发布到番茄或头条后台、登录作者账号。
- 自研模型或训练；只做模型选择与路由。
- 多人协作、云同步、账号体系与计费。
- 除番茄与头条外的其他平台（公众号、起点、知乎等），但架构上预留体裁扩展位。

# 2. 现有资产盘点

## 2.1 inspiration-forge-suite 1.3.0（长篇方法论）

| Skill | 职责 | 主要产物 | 自带脚本 |
|---|---|---|---|
| inspiration-forge | 灵感装填与规划：故事根基、节奏档位（快爽/稳推/慢燃）、全书/卷/幕/章纲 | story_foundation、volume/act/chapter outline、人物/势力/规则卡、变更方案 | `check_outline.py`（format / readiness） |
| inspiration-forge-library | 拆书与技法提炼：精简拆解、五层拆解卡、多本比较、入库 | 拆解卡、技法卡（三步做法/重造条件/失效边界）、对照表 | `novel_scanner.py`（百万字量化测绘）、`quote_check.py`（引文逐字核对） |
| novel-writer | 正文写作与精修：写手直出 + 编辑四类硬伤、L1–L3 改动层级、连续性、番茄发布检查 | 章节草稿、审改清单、定稿 | `manuscript_linter.py`、`ledger_check.py`、`init_project.py`、`archive_draft.py`、`safe_io.py` |

三者之间已有"交接契约"：规划 → 正文、拆书 → 规划，边界清晰（规划不写正文、拆书不改规划）。

## 2.2 织章 dsh-zhizhang 0.20.0（长篇工程层）

- DSH bundle 插件，Node ≥ 22，挂载后只注册 `zhizhang_enable`，启用后向当前 Agent 挂载 52 个工具与硬规则段落。
- 覆盖：作品/根基/章纲/章节、候选暂存与采纳、审读声明与定稿、修订历史、参考库与拆书、灵感/规划、风格扫描与表达诊断、汇编导出、作者写作台面板。
- 核心理念：**暂存 ≠ 采纳 ≠ 定稿**；一个章节只有一份现行正文；多文件写入有意图日志与恢复。
- 插件本身不调用模型。待办：深度模型诊断、Agent 会话投递未开放；真实 DSH 桌面与 Windows 文件系统验收未完成。

## 2.3 toutiao-viral-writer 4.0.0（头条方法论）

- 两条内容线：资讯线（热点、政策、生活实用）、故事线（神话、传说、民间故事改编）；默认长图文约 3000 字（主稿约 2000 + 延伸约 1000）。
- 七步：S1 找题 → S2 立项（立项卡 JSON）→ S3 标题（1 主 4 备，34 字上限）→ S4 成文 → S5 红笔 → S6 质检（overall ≥ 84、零 fail、无硬闸，最多两轮）→ S7 交稿（交稿单 + 台账）。
- 脚本：`rules.py`（唯一规则源）、`qa_check.py`（质检，支持 `--card` 核对立项卡与台账）、`fetch_hot.py`（热榜）、`ledger.py`（台账 add/status/show）、`tests/test_gates.py`。
- 状态词：初稿待改 → 待验收 → 已验收 / 验收退回 → 已交稿。

## 2.4 差距清单

| # | 差距 | 影响 | 本方案的处理 |
|---|---|---|---|
| G1 | 头条线没有工程层 | 立项卡、稿件版本、质检结果散落文件夹，无门禁 | 新建 `dsh-toutiao` 插件 |
| G2 | Skill 脚本未工具化 | 模型可能不跑、跑错参数、忽略结果 | 统一脚本运行器 + 正式工具 |
| G3 | novel-writer 自有项目布局与织章存储并存 | 两套"真相"，易冲突 | 织章为唯一真相源，改写 Skill 的落盘指令 |
| G4 | 无体裁路由 | 两套规则同时进上下文，互相干扰、浪费 token | 体裁 preset + 工具可见性收窄 |
| G5 | 门禁靠自觉 | 未授权定稿、未过质检即交稿 | `tools/pre-execute` 门禁插件 |
| G6 | 安装门槛高 | 作者不会用 CLI | writer profile + 一键安装器，后期品牌桌面包 |
| G7 | 规则重复（如 `manuscript_linter` 与 `zhizhang_style_lint`） | 两套标准打架 | 合并为一个规则源 |

# 3. 关键决策

## 3.1 方案比较

| 维度 | A. Fork DSH 改内核 | B. DSH 插件 bundle + writer profile（推荐） | C. 完全独立应用 |
|---|---|---|---|
| 开发量 | 中 | 小到中 | 大 |
| 复用织章 | 是 | 是，原样 | 需剥离重写宿主依赖 |
| 跟随上游升级 | 难，持续合并冲突 | 易，只改适配层 | 不涉及 |
| 产品自主度 | 高 | 中，品牌包可补 | 最高 |
| 契合 DSH 设计 | 违背（官方明确"无特权内核可改"） | 契合 | 不涉及 |

## 3.2 决策

**采用方案 B**：不 fork 内核；交付一个「写作 bundle」（若干 Cordis 插件 + Skill 内容）和一个 `writer` profile。若后续需要自有品牌桌面包，只改打包与默认 profile，写作能力仍留在插件里。

依据：DSH 官方架构说明"每一部分都是插件，包括模型适配、工具注册、会话日志与 Agent 循环本身"，"没有可打补丁的特权内核，扩展方式是在旁边挂载插件"。织章已验证了 bundle 路线。

## 3.3 版本策略

- 锁定一个 DSH 版本（精确版本号）开发与测试；升级走专门分支，跑完整回归后再放开。
- 所有对 DSH API 的调用集中在 `@writer/dsh-adapter`，业务插件不直接 import DSH 包。

# 4. 总体架构

## 4.1 分层视图

| 层 | 名称 | 组成 |
|---|---|---|
| L4 | 交互层 | 体裁选择卡、织章写作台（长篇）、头条工作台、DSH 聊天 |
| L3 | 方法层 | Skill 内容包（Markdown + 示例 + 语料）：forge-plan、forge-library、novel-writer、toutiao |
| L2 | 体裁层 | 织章 dsh-zhizhang（长篇）、dsh-toutiao（头条，新建） |
| L1 | 平台层 | writer-core：体裁路由、Skill 装载、脚本运行器、门禁、角色/模型路由、工作区配置、dsh-adapter |
| L0 | 宿主层 | DSH：llm 适配、tools 注册与执行管线、session 日志、agent-loop、subagents、compaction、approval、sandbox |

依赖方向自上而下；L2 之间互不依赖；L3 只是内容，不含代码逻辑（脚本迁到 L1/L2 以工具形式提供）。

## 4.2 包组成（bundle）

| 包 | 类型 | 职责 | 状态 |
|---|---|---|---|
| `@writer/dsh-adapter` | 库 | 封装 DSH API：注册工具、注入段落、读写 session 事件、子代理调用 | 新建 |
| `@writer/core` | Cordis 插件 | 体裁路由、Skill 装载、脚本运行器、工作区配置、`writer_*` 工具 | 新建 |
| `@writer/gates` | Cordis 插件 | 基于 `tools/pre-execute` 的授权与质量门禁 | 新建 |
| `@writer/roles` | Cordis 插件 | 规划师 / 写手 / 编辑 / 质检 等角色 preset 与模型路由 | 新建 |
| `dsh-zhizhang` | Cordis 插件 | 长篇工程层 | 已有，少量改造 |
| `@writer/dsh-toutiao` | Cordis 插件 | 头条工程层 + 工作台面板 | 新建 |
| `@writer/skills-fanqie` | 内容包 | forge-plan / forge-library / novel-writer 的 Markdown 与资产 | 由现有 Skill 改写 |
| `@writer/skills-toutiao` | 内容包 | toutiao 的 references / corpus / templates | 由现有 Skill 改写 |
| `@writer/rules` | Python 包 | 所有确定性检查脚本（质检、章纲、引文、扫描、台账） | 由现有脚本整理 |
| `dsh-writer-bundle` | bundle | 汇总以上，提供 `cordis.patch.yml` | 新建 |
| `writer` profile | profile 模板 | 默认模型、启用 bundle、存储路径、禁用编码类工具 | 新建 |

## 4.3 代码仓库结构（建议 monorepo）

```
writer-agent/
├─ packages/
│  ├─ dsh-adapter/          # TS，唯一直接依赖 DSH 的包
│  ├─ core/                 # TS，体裁路由、Skill 装载、脚本运行器
│  ├─ gates/                # TS，门禁
│  ├─ roles/                # TS，角色与模型路由
│  ├─ toutiao/              # TS，头条插件 + client/ 面板
│  ├─ zhizhang/             # git submodule 或 workspace 引用织章
│  └─ bundle/               # dsh-writer-bundle：package.json(dsh.bundle) + cordis.patch.yml
├─ skills/
│  ├─ fanqie/forge-plan/ forge-library/ novel-writer/
│  └─ toutiao/
├─ rules/                   # Python：rules_toutiao.py、qa_check.py、check_outline.py …
│  └─ tests/
├─ profiles/writer/         # profile 模板与默认 patch
├─ installer/               # 一键安装脚本（Win/mac）
└─ docs/
```

# 5. 平台层设计（writer-core）

## 5.1 体裁路由

**目标**：一个会话只属于一种体裁，只看到这种体裁的规则与工具。

- 会话开始时，体裁选择卡（Chat 节点）让用户选「番茄长篇」或「头条图文」，也可由首句意图识别后确认。
- 选择结果写入会话事件（扩展 `SessionEventMap`：`writer/genre`），保证重载、分叉后仍可还原（DSH 原则："模型可见即记录在日志"）。
- 路由动作：
  1. 通过 `ctx.systemPrompt.section()` 注入该体裁的总则段落（铁律、状态词、交付边界）。
  2. 通过 `ctx.tools.restrict()` 只暴露该体裁工具 + 通用工具；隐藏 bash、编辑代码等与写作无关的工具。
  3. 长篇自动调用 `zhizhang_enable`；头条自动调用 `toutiao_enable`。
- 切换体裁 = 新开会话（避免规则残留），界面上提供"以此为素材新开头条稿"之类的跨体裁动作。

## 5.2 Skill 装载

DSH 的 Skill 机制为"段落 + 工具注册，调用时 `inject()` 内容"。本方案分三级装载，控制上下文体积：

| 级别 | 内容 | 何时进入上下文 |
|---|---|---|
| 常驻 | 每个 Skill 的路由表与铁律（SKILL.md 精简版，约 1–2k 字） | 选定体裁后 |
| 按步 | 当前步骤的 reference（如 `s3-headline.md`、`writing.md`） | 调用 `writer_method_get(step)` 或对应工具回执里附带 |
| 按需 | 示例、语料、案例 | Agent 显式请求，按垂类 / 题材只取一份 |

改写要点：

- Skill 中"运行 `python3 scripts/xxx.py`"一律改为"调用工具 `xxx`"。
- novel-writer 中关于自有目录布局（`workspace/`、`archive_draft`、`init_project`）的说明改为织章工具链（`zhizhang_project_create`、`candidate_stage → accept`、审读、定稿）。
- 每个 Skill 增加 `skill.json` 元数据：体裁、步骤、依赖工具、版本，供装载器与测试使用。

## 5.3 脚本运行器

所有确定性检查统一由运行器执行，作为工具暴露给模型。

- **执行**：通过 DSH 的 `ctx.subprocess` / `ctx.sandbox` 启动 Python，只读挂载规则包，写入限定在作品目录。
- **契约**：所有脚本统一 `--json` 输出 `{version, ok, score?, items[], hard_gates[], raw}`；运行器校验 schema，失败视为工具错误而非"通过"。
- **Python 来源**：优先使用 DSH 发行包捆绑的 Python（其第三方声明中列有 Bundled Python distributions，M0 验证插件能否调用）；否则安装器附带嵌入式 Python。脚本只依赖标准库，这一点要保持。
- **长期**：若 Python 依赖成为负担，把 `rules` 移植为 TS，但只保留一个规则源，用同一组 fixtures 做对拍测试。

## 5.4 角色与模型路由（writer-roles）

novel-writer 已明确"写手负责落稿，编辑负责验收，两者分开回报"；头条 S5 红笔、S6 质检同理。用 DSH 的 agent preset 与 `ctx.subagents` 落实：

| 角色 | 承担步骤 | 上下文 | 模型建议 |
|---|---|---|---|
| 主控（编排） | 与作者对话、路由、汇报 | 会话全量 | 通用主模型 |
| 规划师 | 根基、卷/幕/章纲、头条立项 | 根基 + 规划资产 | 推理强的模型 |
| 写手 | 章节正文、头条 S4 成文 | 章简报（lean）、立项卡、写法 reference | 中文文笔最好的模型 |
| 编辑 | 审读、L1–L3 改稿、S5 红笔 | **新上下文**，只给稿件 + 依据 | 与写手不同的模型或不同温度，避免自我放水 |
| 质检 | 脚本 + 九项人工速查清单 | 稿件 + 脚本结果 | 小模型即可 |

- 编辑使用新开子代理，保证独立审读；回报格式固定（四类硬伤、L1–L3、三联表）。
- 模型可在 writer profile 中按角色配置，作者可在设置里覆盖。

## 5.5 门禁（writer-gates）

在 `tools/pre-execute` 上实现，返回 allow / deny / ask（ask 走 `ctx.approval`，由作者在界面确认）：

| 门禁 | 规则 | 结果 |
|---|---|---|
| 定稿授权 | `zhizhang_chapter_save(status=final)`、定稿类操作需本轮作者明确授权 | 无授权 → ask |
| 覆盖定稿 | 带 `force` 修改定稿正文 | 一律 ask |
| 头条验收 | `toutiao_status(to=已验收)` 需最近一次 `toutiao_qa_check` 通过（≥ 84、零 fail、无硬闸）且针对当前稿件哈希 | 否则 deny，附原因 |
| 头条交稿 | `已交稿` 只能由作者在工作台点击，或在对话中明确说采用 | 否则 deny |
| 打回轮次 | 同一稿件质检打回超过 2 轮 | 停止自动改写，交作者决定 |
| 平台操作 | 任何浏览器登录 / 发布番茄、头条后台的动作 | 默认 deny |
| 事实出处 | 头条资讯线立项卡"出处"为空或仍是 `[方括号]` 占位 | 禁止进入 S4 |

门禁规则表放在配置里，作者可以放宽非安全类门禁（如打回轮次），安全类门禁不可关闭。

## 5.6 工作区与存储根

```
<写作根>/                        # writer profile 中配置，默认 ~/WriterAgent
├─ novels/                       # 织章 worksRoot：每本书一个目录
├─ library/                      # 织章 libraryRoot：拆书库（index.json、sources/、cards/）
├─ sources/                      # 织章 sourceRoot：待拆原文 .txt/.md
├─ toutiao/                      # dsh-toutiao 根
│  ├─ articles/YYYY-MM-DD-slug/  # 一篇一目录
│  ├─ log.csv                    # 发稿台账（沿用现有格式）
│  ├─ feedback.md                # 作者改稿反馈
│  └─ hot/                       # 热榜快照
└─ .writer/                      # 平台层：配置、规则版本、备份
```

# 6. 长篇线设计（番茄）

## 6.1 职责划分

| 层 | 负责 |
|---|---|
| 织章 | 作品数据、版本、候选、审读声明、定稿、修订影响、参考库、汇编、写作台 |
| Skill（forge-plan / forge-library / novel-writer） | 怎么想、怎么写、怎么审：节奏档位、章纲四项头注、写手四个落点、编辑四类硬伤等 |
| writer-core | 装载 Skill、运行脚本、路由角色、门禁 |

## 6.2 脚本与织章工具的对应

| 现有脚本 | 处理 | 新工具 / 归属 |
|---|---|---|
| `check_outline.py` | 保留，改为读取织章章纲 | `fanqie_outline_check(mode=format\|readiness)` |
| `manuscript_linter.py` | 与 `zhizhang_style_lint` 合并规则，保留一个规则源 | `zhizhang_style_lint`（扩展词表） |
| `ledger_check.py` | 保留，读取织章根基 happened / threads | `fanqie_ledger_check(chapters)` |
| `novel_scanner.py` | 保留 | `library_scan(source, keywords)` |
| `quote_check.py` | 保留，拆解卡入库前强制 | `library_quote_check(source, card)` |
| `init_project.py` | 由织章取代 | `zhizhang_project_create` |
| `archive_draft.py` | 由织章取代 | 审读声明 + 定稿流程 |
| `safe_io.py` | 由织章存储层取代 | — |

## 6.3 织章需要的改造

1. 补齐真实 DSH 桌面、Windows 路径验收（长篇线的地基，M0 必做）。
2. 开放"Agent 会话投递"：写作台按钮（如"续写下一章""按此候选改稿"）能把指令投递到当前会话。
3. 接入 writer-core 的体裁路由，由路由自动调用 `zhizhang_enable`。
4. 与 forge 模板字段对齐：`story_foundation`、`chapter_outline` 四项头注与织章根基、章纲字段（situationLens / livedScene / stateLens 等）建立一一映射，写进 `docs/MAP.md`。
5. 增加"节奏档位"字段（快爽 / 稳推 / 慢燃）到根基，供写手与检查脚本读取。

## 6.4 典型流程

**开新书到黄金三章**

1. 作者给脑洞 → 规划师按 forge-plan 产出故事根基候选（卖点、关键人物、能力规则、节奏档位）→ 作者采纳 → `zhizhang_foundation_set`。
2. 规划师产出首卷路线与前 3 章章纲 → `fanqie_outline_check(readiness)` → 作者采纳 → `zhizhang_outline_set`。
3. 写手：`zhizhang_chapter_brief(lean)` → 写正文 → `zhizhang_candidate_stage`。
4. 编辑子代理：独立审读 → 输出硬伤与 L1–L3 → 必要时 `candidate_edit_stage`。
5. 作者在写作台对照、采纳（内置扫描）→ 审读声明 → 授权后定稿。

**日更续写**

`zhizhang_status` 恢复现场 → 取下一章章纲（缺则先补）→ 简报 → 写 → 审 → 作者采纳；定稿后 `foundation_append_happened` 记本章后果，`fanqie_ledger_check` 核旧账。

**拆书**

`library_import` → `library_scan` 量化测绘 → 精简拆解或五层拆解卡 → `library_quote_check` → 作者授权入库 → 规划时 `library_combo_suggest` 调用技法卡。

# 7. 头条线设计（dsh-toutiao，新建）

## 7.1 数据模型

**文章（Article）**

| 字段 | 说明 |
|---|---|
| id | `YYYY-MM-DD-slug` |
| line | 资讯线 / 故事线 |
| genre | 长图文 / 短图文 / 微头条 |
| status | 初稿待改 / 待验收 / 已验收 / 验收退回 / 已交稿 |
| card | 立项卡（沿用现有 `brief.json` 结构，用 JSON Schema 校验） |
| drafts[] | 稿件版本：`{rev, role(写手/编辑), sha256, created_at, note}` |
| current_rev | 当前稿 |
| qa[] | 质检记录：`{rev_sha256, overall, fails, hard_gates, raw, rules_version}` |
| headlines | 1 主 4 备 |
| delivery | 交稿单路径 |

**目录布局**

```
toutiao/articles/2026-10-28-rent-gjj/
├─ 立项卡.json
├─ drafts/r1.md  r2.md  …
├─ current.md            # 指向当前版本的副本
├─ qa/r2.json
├─ edits/r2-三联表.md
├─ 交稿单.md
└─ meta.json             # 状态、版本、哈希
```

## 7.2 工具清单

| 工具 | 步骤 | 说明 |
|---|---|---|
| `toutiao_enable` | — | 启用并挂载头条规则段落 |
| `toutiao_hot_fetch(top, vertical, relevant)` | S1 | 封装 `fetch_hot.py`；失败返回退出码供改用网页搜索 |
| `toutiao_evergreen_list(window)` | S1 | 节点日历 + 台账撞题过滤 |
| `toutiao_card_create / get / patch` | S2 | 立项卡读写，Schema 校验，占位符检测 |
| `toutiao_select_score(candidates)` | S2 | 按线打分（规则来自 `rules.py`） |
| `toutiao_headline_set(main, alts)` | S3 | 34 字硬上限校验，回填立项卡 |
| `toutiao_draft_stage(content, role)` | S4/S5 | 新稿件版本，不覆盖旧版本 |
| `toutiao_edit_record(rev, table)` | S5 | 保存三联表 |
| `toutiao_qa_check(rev)` | S6 | 封装 `qa_check.py --card --json`，结果绑定稿件哈希 |
| `toutiao_status(to)` | S6/S7 | 状态流转，受门禁约束 |
| `toutiao_delivery_build()` | S7 | 按模板生成交稿单，末句固定"——AI 到此止步。是否采用、何时发布由你决定。" |
| `toutiao_ledger_add / show` | S7 | 封装 `ledger.py` |
| `toutiao_feedback_append(before, after, why)` | 全程 | 作者改稿反馈；同类动机满三次提示固化 |
| `toutiao_rules()` | — | 输出现行规则（`qa_check.py --rules`） |

## 7.3 状态机

| 当前状态 | 触发 | 下一状态 |
|---|---|---|
| （无） | `toutiao_draft_stage` 首稿 | 初稿待改 |
| 初稿待改 | 红笔完成、提交验收 | 待验收 |
| 待验收 | `toutiao_qa_check` 通过 + 门禁放行 | 已验收 |
| 待验收 | 质检不通过 | 验收退回 |
| 验收退回 | 改稿后重新提交（同稿最多 2 轮，超出停止自动改写，交作者） | 待验收 |
| 已验收 | 作者在工作台点"采用"或明确说采用 | 已交稿 |
| 已验收 | 作者退回 | 验收退回 |

## 7.4 头条工作台（面板）

- 左栏：选题池（热榜快照 / 常青节点）与文章列表（按状态过滤）。
- 中栏：立项卡表单（主问题、延伸、出处、锚点人物、开头式/结尾式），稿件阅读与版本对照。
- 右栏：标题矩阵、质检报告（总分、fail 项、硬闸、按段定位）、状态与操作（采用、退回、导出纯文本）。
- 导出：去 Markdown 符号、只保留规范中文标点的纯文本，便于粘贴到头条后台；附发布设置提醒（首发、AI 生成声明、虚构演绎标识）。

## 7.5 典型流程（长图文）

1. S1：`toutiao_hot_fetch` → 候选清单（一行摘要）。
2. S2：作者选题 → 规划师填立项卡（主问题 + 延伸 + 出处）→ 门禁检查出处 → 作者确认。
3. S3：标题五母体各一版 → `toutiao_headline_set`。
4. S4：写手按蓝图写主稿与延伸 → `toutiao_draft_stage(r1)`。
5. S5：编辑子代理红笔 → 三联表 + `r2`。
6. S6：`toutiao_qa_check(r2)` → 不过则回 S5（≤ 2 轮）→ 过线后九项人工速查 → `待验收`。
7. S7：交稿单 + 台账 → 作者在工作台点"采用" → `已交稿`。

# 8. 交互层

| 界面 | 来源 | 说明 |
|---|---|---|
| 体裁选择卡 | 新建，`ConversationNodeDefinition` | 会话首屏；之后在会话顶部显示当前体裁 |
| 织章写作台 | 已有 | 增加 Agent 投递按钮 |
| 头条工作台 | 新建 | 见 7.4 |
| 步骤进度条 | 新建，Chat 节点 | 头条 S1–S7、长篇"规划/写/审/定稿"的当前位置 |
| 斜杠命令 | `ctx.commands` | `/新书` `/续写` `/拆书` `/头条` `/质检` `/交稿` 等，不经模型直接触发流程 |

原则：面板只读或经确认写回，不在单击中静默写入；正文创作始终发生在会话中，由 Agent 完成。

# 9. 上下文与长期记忆

- **长篇**：章简报只取本章与明确关联材料（织章已实现 lean 模式）；上下文压缩使用 DSH `ctx.compaction`，压缩后主控先调用 `zhizhang_status` 恢复现场（织章已有约定）。
- **头条**：每篇独立，开工先读台账最近 N 条与 `feedback.md`，用于防撞题与吸收作者偏好。
- **作者偏好**：两条线共用 `.writer/preferences.md`（文风、禁用词、常用垂类），由 memory 段落注入。

# 10. 质量体系

| 层次 | 手段 | 负责人 |
|---|---|---|
| 机检 | `rules` 脚本：头条 `qa_check`、章纲 `check_outline`、风格扫描、引文核对、旧账核对 | 脚本运行器 |
| 独立审读 | 编辑子代理，新上下文，固定回报格式 | 编辑角色 |
| 人工终审 | 采纳、定稿、交稿由作者确认 | 作者 |

- 规则单一来源：头条只改 `rules.py`；长篇风格规则与 linter 合并后同样只保留一处。
- 规则版本号写入每一次质检记录，便于追溯"按哪版规则通过的"。
- 回归测试：沿用 `tests/test_gates.py` 与织章 `npm run check`，新增端到端用例（固定输入稿 → 期望分数区间与 fail 项）。
- 不把"骗过 AI 检测"作为目标；去 AI 味只为好读（沿用 toutiao Skill 底线）。

# 11. 合规与平台底线

1. 不代作者登录、不代发；所有发布由作者在平台后台完成。
2. 头条：交稿单提醒"AI 生成"声明（《人工智能生成合成内容标识办法》2025-09-01 施行）、故事线及合成人物勾"虚构演绎"、首发由作者决定。
3. 硬事实必须有本次核实过的出处，写进立项卡；`corpus/` 与搜索摘要不算出处。
4. 番茄：发布前检查去 Markdown / 批注残留与 AI 声明提醒（novel-writer `fanqie_platform.md`）。
5. 平台规则有时效：规则文件记录"依据公告与日期"，设立季度复核任务。

# 12. 模型策略

- 通过 DSH `ctx.llm` 适配器接入，profile 中按角色配置模型与温度。
- 默认用 DeepSeek 系列；写手角色允许作者切换为其他中文文笔更合适的模型（DSH 支持多适配器）。
- 编辑与写手使用不同模型或不同参数，降低自我认同偏差。
- 确定性判断（字数、标点、占位符、分数）一律交给脚本，不让模型"估计"。
- 成本控制：常驻段落精简；语料按需注入；质检角色用小模型。

# 13. 风险与对策

| 风险 | 可能性 | 影响 | 对策 |
|---|---|---|---|
| DSH 破坏性升级（官方明示，主要落在插件 API） | 高 | 高 | 锁版本；`dsh-adapter` 隔离；升级前跑全量回归 |
| 织章桌面 / Windows 未验收 | 中 | 高 | M0 先补验收；问题清单优先修 |
| 插件调用 Python 受限 | 中 | 中 | M0 验证捆绑 Python；备选嵌入式 Python；长期可移植 TS |
| 上下文膨胀导致规则遗忘 | 中 | 中 | 三级装载；体裁隔离；关键规则下沉为门禁 |
| 作者安装门槛 | 高 | 中 | 一键安装器；后期品牌桌面包 |
| 平台规则变化 | 高 | 中 | 规则版本化；季度复核 |
| 两线规则冲突或重复 | 中 | 低 | 规则单一来源；体裁隔离 |

# 14. 实施路线

| 阶段 | 周期（估） | 交付 | 验收标准 |
|---|---|---|---|
| M0 地基 | 1–2 周 | 锁定 DSH 版本；`dsh-adapter` 雏形；织章桌面 + Windows 验收；验证 Python 调用、`tools.restrict`、`systemPrompt.section`、子代理、Chat 节点五项扩展点 | 五项扩展点各有可运行的最小示例；织章在目标桌面完成一章"暂存→采纳→审读→定稿" |
| M1 头条 MVP | 2–3 周 | `dsh-toutiao` 工具链 + 状态机 + 门禁；toutiao Skill 改写为工具调用；最简工作台（文章列表 + 质检报告） | 从热榜到交稿单一条龙跑通；未过质检无法置为已验收；测试 fixtures 全过 |
| M2 平台层 | 2 周 | `writer-core` 体裁路由、Skill 三级装载、脚本运行器统一契约；`writer` profile | 新会话选体裁后只出现该体裁工具；两种体裁在同一安装中互不干扰 |
| M3 长篇整合 | 2–3 周 | forge 三个 Skill 改写；脚本工具化；织章字段映射与节奏档位；写作台投递按钮；编辑子代理 | 开新书到黄金三章、日更续写、拆书入库三条流程跑通 |
| M4 打磨与发布 | 2 周 | 头条工作台完整版；斜杠命令；一键安装器；文档与示例作品 | 非技术作者按文档 15 分钟内装好并写出第一篇 / 第一章 |
| M5（可选） | 视需要 | 品牌桌面包；更多平台体裁 | — |

建议先做 M1（头条）再做 M3（长篇）：头条单篇闭环短、规则已高度脚本化，能最快验证"工具化 + 门禁 + 工作台"这套平台模式，再推广到长篇。

# 15. 待决事项

1. 是否开源本产品，以及与织章的仓库关系（同仓 monorepo 还是独立仓引用）。
2. 首发形态：仅 DSH 插件（面向会用 DSH 的作者）还是同步做品牌桌面包。
3. 默认模型与是否允许接入非 DeepSeek 模型。
4. 头条热榜抓取的合规边界与失败兜底（网页搜索 / 用户粘贴）。
5. 长篇是否首期就开放多草稿（织章 `multiDraft`）。
6. 作者偏好与反馈是否跨作品共享。

# 附录 A：织章工具分组（0.20.0，52 个）

- 作品与根基：`project_create/open/list`、`status`、`foundation_get/set/append_happened`、`product_map`、`system_brief`
- 章纲与章节：`outline_get/set`、`chapter_list/read/save/brief/drafts`
- 候选与编辑：`candidate_stage/accept`、`candidate_edit_brief/stage/decide`、`candidate_unify_brief/stage`
- 审读与诊断：`review_ledger`、`style_lint`、`human_feel_audit`、`novel_sense_audit`、`payoff_audit`
- 灵感与规划：`inspire_start/status/stage/accept/forge_brief`
- 参考库与拆书：`library_import/list/search/plan/report/audit/combo_suggest/dissect_brief/facts_stage/structure_stage/card_stage/card_accept/card_discard/card_get`、`reference_analyze`
- 方法与汇编：`method_list/get`、`assemble`、`panel_snapshot`、`enable`

（工具名均带 `zhizhang_` 前缀。）

# 附录 B：DSH 扩展点与本方案用途对照

| DSH 扩展点 | 本方案用途 |
|---|---|
| `ctx.tools.register()` / `defineTool` | 头条工具、脚本工具、writer 工具 |
| `ctx.tools.restrict()` | 体裁工具可见性 |
| `ctx.systemPrompt.section()` | 体裁总则、Skill 常驻段落 |
| `agent.inject()` | 按步 / 按需注入 reference 与语料 |
| `tools/pre-execute` + `ctx.approval` | 门禁与作者确认 |
| `ctx.subagents` + agent preset | 编辑、质检等独立角色 |
| `ctx.llm` 适配器 | 按角色模型路由 |
| `ctx.compaction` | 长会话压缩 |
| `SessionEventMap` 扩展 | 记录体裁、步骤进度等持久状态 |
| `ConversationNodeDefinition` | 体裁选择卡、步骤进度条 |
| `ctx.commands` | 斜杠命令 |
| `ctx.subprocess` / `ctx.sandbox` | 运行 Python 规则脚本 |
| bundle `cordis.patch.yml` + profile | 打包与默认配置 |
