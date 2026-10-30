---
title: 写作 Agent 开发计划（可执行版）
subtitle: 交给 GPT 编码 · 由 Hark 审查 · v1.0
date: 2026-10-28
---

# 0. 怎么用这份计划

- 这份计划配合《写作 Agent 架构设计与实施方案 v0.1》使用：架构文档回答"做成什么样"，本计划回答"按什么顺序、每一步交什么、怎么验收"。
- 每个任务（T 编号）就是一次交给 GPT 的工作单元，原则上**一个任务 = 一个 PR / 一个提交包**。
- 你把任务卡（第 4 节模板）连同本计划和架构文档一起发给 GPT；GPT 交付后，把代码（仓库链接或压缩包）+ 测试输出 + 交付说明发给我，我按第 9 节清单审查。
- 计划刻意把"验证 DSH 真实能力"放在最前面。DSH 是 developer preview，**任何 GPT 没在锁定版本源码里找到出处的 API 都不许用**。

# 1. 现实校准

## 1.1 投入假设

| 项 | 假设 |
|---|---|
| 人力 | 你 1 人统筹 + GPT 编码 + Hark 审查 |
| 你每周投入 | 约 10–15 小时（发任务、跑测试、桌面实测、拍板） |
| 设备 | 至少一台 Windows 机器（目标作者多用 Windows）+ 可选 macOS |

## 1.2 工期

| 阶段 | 乐观 | 现实 | 说明 |
|---|---|---|---|
| M0 地基与验证 | 1.5 周 | 2 周 | 不可跳过 |
| M1 头条 MVP | 3 周 | 4 周 | 第一个可用产品 |
| M2 平台层 | 2 周 | 2.5 周 | 体裁路由、Skill 装载、统一运行器 |
| M3 长篇整合 | 3 周 | 4 周 | 依赖织章作者配合程度 |
| M4 打磨与发布 | 2 周 | 3 周 | 安装器、文档、内测 |
| 缓冲 | — | 2 周 | DSH 升级、返工 |
| **合计** | **约 11.5 周** | **约 17.5 周（4 个月）** | |

**第一个能给自己用的版本在第 6 周左右（M1 结束）**；能给其他作者内测的版本在第 4 个月。

## 1.3 我替你先定的默认值（可改）

架构文档第 15 节的待决项，为了不卡开发，先按下面执行，你随时可以改：

| 待决项 | 默认 |
|---|---|
| 开源与仓库 | 私有 monorepo；织章以 git submodule 引入，不改其仓库归属 |
| 首发形态 | 先做 DSH 插件 bundle，品牌桌面包放到 M5 再议 |
| 默认模型 | DeepSeek（DSH 内置适配器），写手角色允许切换 |
| 热榜抓取 | 沿用 `fetch_hot.py`；失败退回网页搜索，再失败请作者粘贴 |
| 长篇多草稿 | 首期关闭（沿用织章默认） |
| 偏好共享 | 两条线共用一份作者偏好文件 |

# 2. 技术基线（锁定）

| 项 | 锁定值 | 理由 |
|---|---|---|
| DSH | `dsh-v0.2.1-rc.4`（0.2.1 正式版发布后切过去） | 0.2.1 线已进入 RC；最新的 `v0.2.2-alpha.2`（2026-10-28）把最低 Node 提到 24.9，并要求插件迁移 `tools.resolve/executable`、异步会话投影等接口，属于破坏性变更，首期不追 |
| Node.js | 24 LTS（≥ 24.9） | 同时满足 DSH 0.2.1（≥ 22）与后续 0.2.2，免得升级时再换运行时 |
| 包管理 | pnpm（DSH 自身用 pnpm） | 与宿主一致 |
| TypeScript | 5.8.x | 与织章一致 |
| 前端 | React 18（宿主提供） | 与织章面板一致 |
| Python | 3.11+，**只用标准库** | 现有脚本均为标准库；保持可移植 |
| 测试 | Node：`node:test`（与织章一致）；Python：`unittest`/`pytest` | 少引入依赖 |
| 插件兼容声明 | 每个插件 `package.json` 写 `engines.dsh`（如 `">=0.2.1 <0.2.2"`） | DSH 0.2.1 起按 `engines.dsh` 判断第三方插件兼容性 |

**规则**：升级 DSH 必须单独开任务（T-UPGRADE），在分支上跑完全部测试和桌面实测后才合并。

# 3. 仓库与工程规范

## 3.1 目录

```
writer-agent/
├─ packages/
│  ├─ dsh-adapter/        # 唯一允许 import @deepseek-ai/* 的业务包
│  ├─ core/               # @writer/core：体裁路由、Skill 装载、脚本运行器
│  ├─ gates/              # @writer/gates：门禁
│  ├─ roles/              # @writer/roles：角色 preset 与模型路由
│  ├─ toutiao/            # @writer/dsh-toutiao：头条插件（src/ + client/）
│  ├─ llm-fake/           # 测试用假模型适配器（按脚本回放）
│  └─ bundle/             # dsh-writer-bundle：package.json(dsh.bundle) + cordis.patch.yml
├─ vendor/zhizhang/       # git submodule：dsh-zhizhang
├─ skills/
│  ├─ fanqie/{forge-plan,forge-library,novel-writer}/
│  └─ toutiao/
├─ rules/                 # Python 规则包（原各 Skill 的 scripts/）
│  ├─ writer_rules/
│  └─ tests/
├─ fixtures/              # 测试样稿、立项卡、期望结果
├─ profiles/writer/
├─ installer/
├─ docs/
│  ├─ architecture.md     # 架构文档
│  ├─ dev-plan.md         # 本计划
│  ├─ dsh-findings.md     # M0 验证结论（每条带 DSH 源码出处）
│  └─ decisions/          # ADR：每个重要决定一页
└─ .github/workflows/ci.yml
```

## 3.2 硬性规范

1. **依赖方向**：`toutiao`、`core`、`gates`、`roles` 只能通过 `dsh-adapter` 使用 DSH；加一个架构守卫脚本（参考织章 `architecture-guard.mjs`）在 CI 检查。
2. **工具命名**：`<域>_<动作>`，域取 `writer_` / `toutiao_` / `fanqie_` / `library_`；织章工具保持 `zhizhang_` 不改。
3. **工具返回值**：一律返回结构化 JSON（`output.schema` 声明），人读的话放 `render`；不得让模型从文字里解析 id。
4. **文件写入**：原子写（写临时文件再 rename）；所有写入限定在配置的写作根下；路径必须做规范化与越界检查。
5. **日志与错误**：业务失败返回 `{ok:false, code, message}`；基础设施失败才抛异常。
6. **中文规范**：面向作者的文案用简体中文；代码标识符、提交信息用英文。
7. **每个 PR 必带**：测试、`CHANGELOG.md` 一行、若改接口则更新 `docs/`。

## 3.3 CI（T0.2 搭好）

- `pnpm -r typecheck` → `pnpm -r test` → `python -m pytest rules/tests` → 架构守卫 → `fixtures` 端到端（M1 起）。
- 在 Windows 与 Linux 两个 runner 上跑（路径问题早发现）。

# 4. 给 GPT 的任务卡模板

每次发任务都用这个格式（复制后填空）：

```
【任务编号】T1.3
【目标】一句话说清楚要做成什么
【背景】相关架构章节：architecture.md §7.2；依赖任务：T1.1、T1.2（已合并）
【输入】现有文件/接口：……
【输出】
  - 新增/修改文件清单
  - 对外接口（函数签名 / 工具 schema / 文件格式）
【验收标准】
  - [ ] 可运行的命令及期望输出
  - [ ] 必须通过的测试（列出用例名）
  - [ ] 边界情况：……
【禁止】
  - 不得使用 dsh-findings.md 中未确认的 DSH API
  - 不得修改 vendor/zhizhang（需要改动时写进交付说明的"上游建议"）
  - 不得引入新的第三方运行时依赖（需要时先说明理由，等确认）
【交付说明要求】见 dev-plan.md §9.1
```

# 5. 关键契约（先定死，所有任务共用）

## 5.1 脚本运行器输出契约

所有 Python 规则脚本在 `--json` 模式下输出：

```json
{
  "tool": "qa_check",
  "rules_version": "4.0.0",
  "ok": true,
  "score": 86,
  "pass": true,
  "fails": [{"code": "F_XXX", "message": "...", "where": {"para": 3}}],
  "warnings": [],
  "hard_gates": [],
  "raw": "原始文本输出（保留，便于对照）"
}
```

- 运行器校验该结构；退出码非 0 且无合法 JSON → 工具错误（`ok:false, code:"SCRIPT_FAILED"`），**绝不当作通过**。
- 超时默认 60 秒，`fetch_hot` 120 秒。

## 5.2 头条文章元数据 `meta.json`

```json
{
  "id": "2026-10-28-rent-gjj",
  "line": "资讯线",
  "genre": "长图文",
  "status": "初稿待改",
  "current_rev": 2,
  "drafts": [
    {"rev": 1, "role": "writer", "sha256": "...", "created_at": "2026-10-28T10:00:00+08:00", "note": ""},
    {"rev": 2, "role": "editor", "sha256": "...", "created_at": "...", "note": "S5 红笔"}
  ],
  "qa": [{"rev": 2, "sha256": "...", "pass": false, "score": 79, "rules_version": "4.0.0", "at": "..."}],
  "return_rounds": 1,
  "headlines": {"main": "", "alts": []},
  "history": [{"from": "初稿待改", "to": "待验收", "by": "agent", "at": "..."}]
}
```

- 状态集合固定：`初稿待改 / 待验收 / 已验收 / 验收退回 / 已交稿`。
- `meta.json` 由插件独占写入；Agent 只能通过工具改。

## 5.3 门禁规则表 `gates.yml`

```yaml
- id: toutiao.accept_requires_qa
  tool: toutiao_status
  when: { to: 已验收 }
  require: latest_qa_pass_for_current_sha
  on_fail: deny
  locked: true          # 作者不可关闭
- id: toutiao.deliver_requires_author
  tool: toutiao_status
  when: { to: 已交稿 }
  require: author_confirmation
  on_fail: ask
  locked: true
- id: toutiao.max_return_rounds
  tool: toutiao_draft_stage
  require: return_rounds_lte_2
  on_fail: ask
  locked: false
- id: fanqie.finalize_requires_author
  tool: zhizhang_chapter_save
  when: { status: final }
  require: author_confirmation
  on_fail: ask
  locked: true
```

## 5.4 错误码

`INVALID_ARGS`、`NOT_FOUND`、`CONFLICT`（版本/哈希不符）、`GATE_DENIED`、`SCRIPT_FAILED`、`TIMEOUT`、`OUT_OF_ROOT`（路径越界）。

# 6. 阶段与任务

> 估时按"GPT 产出 + 你验证 + 我审查"一个来回计。⚑ 表示需要你本人在真实 DSH 桌面上操作。

## M0 地基与验证（第 1–2 周）

**目的**：确认 DSH 真的支持我们要用的每个扩展点，把结论写成可复用的最小示例。M0 不写业务功能。

| 任务 | 内容 | 交付物 | 验收 | 估时 |
|---|---|---|---|---|
| T0.1 环境锁定 ⚑ | 安装 DSH `dsh-v0.2.1-rc.4` 桌面版与 CLI；Node 24；记录 `dsh --version`、profile 目录 | `docs/env.md` | 能启动桌面、能用 `dsh plugin --profile desktop add` 装织章 0.20.0 | 0.5 天 |
| T0.2 仓库骨架 | monorepo、pnpm workspace、tsconfig、CI（Win + Linux）、架构守卫、织章 submodule | 仓库初始提交 | CI 绿；`pnpm -r build` 通过 | 1 天 |
| T0.3 Hello 工具插件 | 用 `defineTool` 注册 `writer_ping`，打包成 bundle，桌面安装 | `packages/core` 雏形 + 安装说明 | ⚑ 会话里调用 `writer_ping` 返回结构化 JSON | 1 天 |
| T0.4 扩展点验证 | 逐项写最小示例并在 `dsh-findings.md` 记结论 + **DSH 源码文件路径**：①`ctx.systemPrompt.section()` ②`ctx.tools.restrict()` 或按步启用 ③`agent.inject()` ④`tools/pre-execute` 返回 deny/ask + `ctx.approval` ⑤子代理 + agent preset ⑥`ctx.subprocess`/`ctx.sandbox` 调 Python ⑦ Chat 节点 `ConversationNodeDefinition` ⑧ `ctx.commands` 斜杠命令 ⑨ 插件会话状态记录 API ⑩ DSH 原生 Skill 目录能否直接加载我们的 Skill | `docs/dsh-findings.md` + `spikes/` | 每项标"可用 / 有限制 / 不可用"，附截图或日志 | 4 天 |
| T0.5 Python 可用性 ⚑ | 验证桌面版捆绑 Python 能否被插件调用；不能则确定嵌入式 Python 方案 | ADR `decisions/001-python-runtime.md` | Windows 上从插件跑通 `qa_check.py --rules` | 1 天 |
| T0.6 织章验收 ⚑ | 在目标桌面 + Windows 路径（含中文和空格）跑一章完整流程 | 问题清单 `docs/zhizhang-acceptance.md` | 暂存→采纳→审读→定稿全部成功，或问题已登记 | 1 天 |
| T0.7 假模型适配器 | `packages/llm-fake`：按脚本文件回放模型输出与工具调用，用于端到端测试 | 包 + 示例脚本 | headless profile 下用假模型跑通 `writer_ping` 调用 | 1.5 天 |

**M0 出口**：`dsh-findings.md` 十项全部有结论；若 ②④⑤⑦ 中有"不可用"，先回到我这里调整架构，再进 M1。

**预案**：

| 若…不可用 | 退路 |
|---|---|
| `tools.restrict` | 用 agent preset 区分体裁工具集；或只在启用工具时注册（织章模式） |
| `pre-execute` 的 ask | 门禁只做 deny；作者确认改成"必须由面板按钮触发"的工具参数 |
| Chat 节点 | 体裁选择改为斜杠命令 + 面板 |
| 捆绑 Python | 嵌入式 Python；再不行，把 `qa_check` 移植为 TS（用同一套 fixtures 对拍） |

## M1 头条 MVP（第 3–6 周）

**目的**：头条一篇长图文从选题到交稿单在 DSH 里一条龙跑通，质检是硬闸。

| 任务 | 内容 | 交付物 | 验收 | 估时 |
|---|---|---|---|---|
| T1.1 规则包整理 | 把 toutiao 四个脚本迁入 `rules/writer_rules/toutiao/`，统一 `--json` 契约（§5.1），保留 `rules.py` 唯一规则源；迁移 `tests/test_gates.py` | Python 包 + 测试 | 原测试全过；新增契约测试；与原脚本对同一批样稿输出分数一致 | 2 天 |
| T1.2 脚本运行器 | `core/runner`：定位 Python、带超时调用、校验契约、映射错误码 | TS 模块 + 单测 | 正常/超时/非法 JSON/退出码非 0 四种情况均有测试 | 1.5 天 |
| T1.3 文章存储层 | `toutiao/store`：建目录、写稿件版本、算 SHA-256、原子写 `meta.json`、状态流转校验 | 模块 + 单测 | 并发写同一文章不损坏；非法状态跳转被拒 | 2 天 |
| T1.4 立项卡 | 立项卡 JSON Schema（基于现有 `brief.json`）；`toutiao_card_create/get/patch`；`[方括号]`、`{xx}` 占位检测 | 工具 + Schema + 测试 | 空出处、未替换占位均能报出具体字段 | 1.5 天 |
| T1.5 选题工具 | `toutiao_hot_fetch`、`toutiao_evergreen_list`（含台账撞题过滤） | 工具 + 测试 | 抓榜失败返回明确错误码，供 Agent 改用搜索 | 1.5 天 |
| T1.6 稿件与标题工具 | `toutiao_draft_stage`、`toutiao_edit_record`、`toutiao_headline_set`（34 字上限） | 工具 + 测试 | 新稿不覆盖旧稿；超长标题被拒 | 1.5 天 |
| T1.7 质检工具 | `toutiao_qa_check(rev)`：调用运行器，结果绑定稿件 SHA 写入 `meta.json` | 工具 + 测试 | 改稿后旧质检结果失效 | 1 天 |
| T1.8 状态、交稿、台账 | `toutiao_status`、`toutiao_delivery_build`（模板 + 固定末句）、`toutiao_ledger_add/show`、`toutiao_feedback_append` | 工具 + 测试 | 交稿单内容与模板一致；台账 CSV 兼容旧格式 | 2 天 |
| T1.9 头条门禁 | `@writer/gates` 首版：读取 `gates.yml`，实现 §5.3 前三条 | 插件 + 测试 | 未过质检置"已验收"被拒且返回原因；打回第 3 轮触发 ask | 1.5 天 |
| T1.10 Skill 改写 | toutiao `SKILL.md` 与各 reference 中"运行 python3 …"全部改为工具调用；精简常驻部分 ≤ 2k 字 | `skills/toutiao/` | 文中不再出现 shell 命令；工具名与实现一致（脚本检查） | 1.5 天 |
| T1.11 启用与段落注入 | `toutiao_enable`：注入头条总则段落、挂载工具（按 M0 结论选方式） | 插件入口 | ⚑ 新会话说"写一篇头条"能自动启用 | 1 天 |
| T1.12 最简工作台 | 面板：文章列表（按状态）、立项卡只读视图、质检报告、"采用"按钮 | `toutiao/client` | ⚑ 面板能看到真实文章；点"采用"后状态为已交稿 | 3 天 |
| T1.13 端到端测试 | 用假模型脚本跑 S1→S7；用 3 篇真实样稿跑质检回归 | `fixtures/toutiao/` + e2e 测试 | CI 中稳定通过 | 2 天 |
| T1.14 真实试写 ⚑ | 你用真模型写 3 篇（资讯线 2、故事线 1），记录问题 | `docs/m1-trial.md` | 3 篇均产出交稿单；问题清单进入 M2 待办 | 1 天 |

**M1 出口**：T1.14 三篇试写完成；严重问题（数据丢失、门禁被绕过）为零。

## M2 平台层（第 7–9 周）

| 任务 | 内容 | 交付物 | 验收 | 估时 |
|---|---|---|---|---|
| T2.1 dsh-adapter 收口 | 把 M1 中直接调用 DSH 的代码全部收进 adapter；守卫脚本强制 | adapter API 文档 | 守卫通过；业务包零 `@deepseek-ai/*` import | 1.5 天 |
| T2.2 体裁路由 | 体裁状态写入会话（按 M0 结论用状态记录 API 或自定义事件）；按体裁注入段落、收窄工具 | `core/genre` | 头条会话看不到 `zhizhang_*`，长篇会话看不到 `toutiao_*` | 2.5 天 |
| T2.3 体裁选择入口 | Chat 节点体裁卡（或斜杠命令 `/头条` `/长篇`，按 M0 结论） | 客户端组件 | ⚑ 新会话首屏可选体裁 | 2 天 |
| T2.4 Skill 三级装载 | `skill.json` 元数据；常驻 / 按步 / 按需三级；`writer_method_get(step)` | 装载器 + 测试 | 常驻段落体积有上限检查；按步内容只在调用后进入上下文 | 2.5 天 |
| T2.5 角色与模型路由 | `@writer/roles`：主控 / 规划师 / 写手 / 编辑 / 质检 preset；编辑以新上下文子代理运行 | 插件 + profile 配置 | 编辑子代理的输入只含稿件与依据（日志可证） | 3 天 |
| T2.6 writer profile | 默认模型、bundle 列表、写作根、关闭编码类工具 | `profiles/writer/` | ⚑ 一条命令创建 profile 并启动 | 1 天 |
| T2.7 回归与试写 ⚑ | M1 全部用例 + 体裁隔离用例；你再写 2 篇头条 | 测试 + 记录 | 全绿；体验问题入 M4 | 1 天 |

## M3 长篇整合（第 10–13 周）

| 任务 | 内容 | 交付物 | 验收 | 估时 |
|---|---|---|---|---|
| T3.1 长篇规则包 | `check_outline`、`ledger_check`、`novel_scanner`、`quote_check` 迁入 `rules/`，统一契约 | Python 包 + 测试 | 原有行为不变（同输入同输出） | 2 天 |
| T3.2 linter 合并 | `manuscript_linter` 与织章 `style_lint` 规则对照表；确定保留哪边、差异如何合并 | ADR + 合并方案 | 你确认方案后再实施；需改织章的写成上游 PR 建议 | 1.5 天 |
| T3.3 字段映射 | forge 模板字段 ↔ 织章根基 / 章纲字段一一映射；新增"节奏档位" | `docs/fanqie-field-map.md` | 每个 forge 必填字段都有落点或明确舍弃理由 | 1.5 天 |
| T3.4 长篇工具 | `fanqie_outline_check`、`fanqie_ledger_check`、`library_scan`、`library_quote_check`，从织章读数据 | 工具 + 测试 | 对 fixtures 作品给出与脚本一致的结果 | 2.5 天 |
| T3.5 Skill 改写 | forge-plan / forge-library / novel-writer：删除自有目录与 `init_project` / `archive_draft` 指令，改为织章工具链 | `skills/fanqie/` | 文中不再出现自有落盘路径；交接契约保留 | 3 天 |
| T3.6 编辑子代理 | 长篇审读：四类硬伤 + L1–L3 固定回报格式；可选产出 `candidate_edit_stage` | 角色配置 + 测试 | 编辑不能调用采纳 / 定稿类工具（门禁或工具集限制） | 2 天 |
| T3.7 长篇门禁 | 定稿授权、`force` 覆盖定稿一律 ask | 门禁规则 | 无授权定稿被拦截 | 1 天 |
| T3.8 写作台投递 | 与织章协作：写作台按钮把指令投递到当前会话（若织章暂不开放，用斜杠命令替代） | 方案 + 实现或替代 | ⚑ 点"续写下一章"能在会话里开工 | 3 天 |
| T3.9 三条流程 e2e | 开新书到黄金三章、日更续写、拆书入库；假模型 + 真样本 | e2e 测试 | CI 稳定通过 | 2.5 天 |
| T3.10 真实试写 ⚑ | 你用真模型开一本新书写到第 5 章 | `docs/m3-trial.md` | 5 章全部定稿；连续性检查无遗漏旧账 | 2 天 |

**依赖风险**：T3.2、T3.8 可能需要织章改动。织章仓库不归本项目，先以"上游建议"形式提交；拿不到就用替代方案，不阻塞发布。

## M4 打磨与发布（第 14–16 周）

| 任务 | 内容 | 交付物 | 验收 | 估时 |
|---|---|---|---|---|
| T4.1 头条工作台完整版 | 选题池、立项卡编辑、版本对照、标题矩阵、纯文本导出、发布设置提醒 | 面板 | ⚑ 不开聊天也能看全一篇稿子的状态 | 4 天 |
| T4.2 斜杠命令 | `/新书` `/续写` `/拆书` `/头条` `/质检` `/交稿` | 命令插件 | 每个命令有说明和测试 | 1.5 天 |
| T4.3 一键安装器 | Windows（PowerShell）+ macOS（shell）：检测 DSH / Node / Python，安装 bundle，创建 writer profile | `installer/` | ⚑ 干净机器 15 分钟内装好 | 3 天 |
| T4.4 数据备份与迁移 | 写作根一键备份；从旧 `outputs/toutiao/` 与织章旧目录导入 | 工具 + 文档 | 导入后旧台账与稿件可见 | 2 天 |
| T4.5 作者文档 | 快速上手、两条线流程、常见问题、合规提醒 | `docs/user/` | 非技术作者按文档完成第一篇 / 第一章 | 2 天 |
| T4.6 内测 ⚑ | 3–5 位作者试用一周，收集问题 | 反馈汇总 | 无数据丢失；P0 问题清零 | 1 周 |

## M5（可选，视内测结果）

品牌桌面包、更多平台体裁、模型诊断深化、TS 版规则引擎。

# 7. 里程碑总表

| 里程碑 | 周次 | 你能看到的结果 | 需要你拍板 |
|---|---|---|---|
| M0 | 1–2 | 十项扩展点验证报告；织章在你机器上跑通 | 若有关键扩展点不可用，是否调整架构 |
| M1 | 3–6 | 在 DSH 里写完 3 篇头条并生成交稿单 | 质检阈值、交稿单格式 |
| M2 | 7–9 | 新会话选体裁；写手与编辑分离 | 各角色默认模型 |
| M3 | 10–13 | 新书写到第 5 章 | linter 合并方案、字段映射 |
| M4 | 14–16 | 安装器 + 文档 + 内测 | 是否对外发布 |

# 8. 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| 规则单测 | 每条规则至少一正一反样例；分数回归（同稿同分） | pytest / unittest |
| 模块单测 | 存储、运行器、门禁、装载器 | node:test |
| 契约测试 | 脚本输出 JSON 契约、工具 output schema | node:test |
| 端到端 | 假模型脚本驱动完整流程；断言文件产物与状态 | headless profile + llm-fake |
| 桌面实测 ⚑ | 每个里程碑末，你在 Windows 桌面按清单走一遍 | 手工清单 `docs/manual-checklist.md` |
| 质量回归 | 固定样稿集：头条 10 篇、长篇 3 章；每次规则改动对比分数变化 | 脚本 |

# 9. GPT 交付与 Hark 审查

## 9.1 GPT 每次交付必须附带

1. **改动清单**：新增 / 修改 / 删除的文件。
2. **接口变化**：工具 schema、文件格式、配置项的增删改。
3. **测试结果**：完整命令与输出（不要只写"已通过"）。
4. **DSH API 出处**：用到的每个 DSH 接口，对应锁定版本源码中的文件路径。
5. **已知限制与未完成项**。
6. **上游建议**：需要织章或 DSH 改动的地方。

## 9.2 我会怎么审

| 维度 | 看什么 |
|---|---|
| 架构一致性 | 依赖方向、是否绕过 adapter、是否把业务塞进 Skill 文本 |
| 契约 | 是否符合 §5 的 JSON 契约、状态集合、错误码 |
| 门禁与授权 | 有没有能绕过质检 / 定稿授权 / 作者确认的路径 |
| 数据安全 | 原子写、路径越界、并发、旧数据兼容 |
| DSH 用法 | API 是否真实存在于锁定版本、是否用了已弃用接口 |
| 测试 | 覆盖是否真实（不是只测快乐路径）、e2e 是否断言产物 |
| 写作业务 | 与原 Skill 规则是否一致：34 字标题上限、≥ 84 过线、两轮打回、固定末句、状态词 |
| 可维护性 | 命名、重复代码、注释、文档同步 |

审查结论分三档：**通过** / **小改后通过**（列出必改项）/ **打回**（说明原因和改法）。

## 9.3 节奏建议

- M0：每个任务都发我审（基础决定一错全错）。
- M1 之后：每 2–3 个任务打包审一次；涉及门禁、存储、DSH 适配的任务单独审。
- 每个里程碑末做一次整体审查（架构偏移、技术债、是否进入下一阶段）。

## 9.4 发给我的方式

- 首选：仓库链接（GitHub 私有仓库可加我能读的方式，或导出压缩包）+ 本次任务编号。
- 压缩包请排除 `node_modules/`、`dist/`、作品数据。
- 附上 §9.1 的交付说明（可直接粘贴 GPT 的回复）。

# 10. 风险与应对

| 风险 | 信号 | 应对 |
|---|---|---|
| DSH 破坏性升级 | 新版本 release notes 出现"插件需迁移" | 不追；在 T-UPGRADE 任务中集中迁移 adapter |
| GPT 编造 DSH API | 交付说明缺少源码出处 | 审查直接打回；`dsh-findings.md` 是唯一可用清单 |
| 织章改动需求无法落地 | 上游无响应 | 用替代方案（斜杠命令、外部检查工具），不阻塞 |
| 规则漂移 | 迁移后同稿分数变化 | 质量回归集强制对比 |
| 进度滑坡 | 单任务超估时 2 倍 | 拆小任务；砍 M4 中的非必需项 |
| 作者不会装 | 内测装机失败 | 安装器优先级提前；考虑 M5 品牌包 |

# 附录 A：发给 GPT 的开场提示词

见交付消息中的独立文本，可直接复制。

# 附录 B：第一周操作清单（给你）

1. 按 T0.1 装好 DSH `dsh-v0.2.1-rc.4` 桌面版和 Node 24。
2. 建私有仓库 `writer-agent`，把三个原始包放进 `legacy/`（只读参考，不参与构建）。
3. 把架构文档、本计划、织章 docs 一并给 GPT，用开场提示词启动 T0.2。
4. T0.2 合并后依次发 T0.3、T0.4；T0.4 结果先发我审。
