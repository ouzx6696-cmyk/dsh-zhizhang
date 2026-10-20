# 工具一览

> 认知入口：[COGNITION.md](./COGNITION.md) · 地图：[MAP.md](./MAP.md) · 策略：[PORTS.md](./PORTS.md)

**按需启用**：挂载时只有 `zhizhang_enable`；调用后才注入下面全部工具与硬规则（仅本会话）。
未启用时普通会话不加载织章工具。

启用后调度主入口：`zhizhang_product_map`（默认 vs 旁路）。

错误对 Agent 只回短中文；本插件不内置 chat/completion。

## 默认路径（抄这一条）

```text
拆书 9 步（0.17.0；回执里的「下一步 N/9」同号）：
1. library_import                交书 → sourceId（回执看编码；report 时自动跑 L0 量化测绘）
2. library_plan                  定档：auto 默认 10% 分层（前 10 章 + 后 3 章 + 等距）；full 须作者明确同意（成本回执 + confirm_token）
3. library_dissect_brief         source, batch=n → 本批原文（≤3 万字/批）
4. library_facts_stage           逐章白描：谁做了什么、结果；没写的动机进 unknowns，禁补
5. library_structure_stage       聚合：kind=plot（六项）/ rhythm（铺垫-释放-反应-衔接）/ character（面具-真相-弧光）
6. library_card_stage            v2 模块：layer + dimension + 5 项 + evidence（可选 steps 三步公式 / bannedDiction 反AI腔词表）；axis 由层/维度推导
7. library_card_accept           5 项 + transfer/failWhen + evidence 逐条回溯；缺项/引文未命中直接拒
8. library_report                19 节报告 + 量化底座（分卷/高频词/热力/锚点/爽点密度）；标 Auto/Full 与覆盖率
9. library_combo_suggest         1 book + N scene → inspire_start / chapter_brief

> Auto 是抽样：全书结论只作「抽样观察」；Full 才可下全书结论。
> L0 量化底座（卷界/章长/词频/热力/锚点）是代码全量扫的，不占抽样额度，报告自动带上。
> 置信度拆三层：覆盖 / 引文证据 / 结构完整；Auto 抽样封顶 0.84。

写作 6 步：
1. chapter_brief(lean) → 2. 写正文 → 3. candidate_stage → 4. style_lint
→ 5.（可选）edit_brief → 改写 → edit_stage → A/B/C → 6. candidate_accept

闸：每张卡答得出五条（可操作 / 特异性 / 非梗概 / 状态落纸 / 失败边界）才算拆完；雷达 0 ≠ 质量过关。
```

Accept 内嵌软传感；**不要**每章跑三 audit。

## 按闭环排列

### 0. 启用 / 定位 / 调度

| 工具 | 作用 |
|------|------|
| `zhizhang_enable` | **唯一常驻**：按需挂载 52 tools + 硬规则到本会话（幂等） |
| `zhizhang_product_map` | **启用后**的调度主入口：默认路径 + 旁路 + 三阶段 |
| `zhizhang_system_brief` | 硬规则钉死 |
| `zhizhang_status` | 作品进度 + 默认下一步 |
| `zhizhang_panel_snapshot` | 面板数据口 |

### 1. 库段（默认）

| 工具 | 下一步 |
|------|--------|
| `library_import` | plan（定档：Auto 10% / Full 须同意） |
| `library_plan` | dissect_brief(batch=0)（按计划取批） |
| `library_dissect_brief` | facts_stage（逐章白描） |
| `library_facts_stage` / `_structure_stage` | card_stage（v2 模块） |
| `library_card_stage` / `_accept` | 读警告 → audit → report → combo_suggest |
| `library_list`（含本地书源目录）/ `_search` / `_card_get` | combo 或 brief |
| `library_audit` | 诊断旁路：引文回溯 / 章号 / 白描违规 / 覆盖率（不改卡） |
| `library_report` | 报告旁路：19 节 report.md，标 Auto/Full 与覆盖率（不代写分析） |
| `library_card_discard` | 清理旁路：confirm=true 删卡 |

> 库段验收：`library_audit` 只查机械面（引文/章号/占位）；**机械面通过 ≠ 卡能用**——须真读原文按五条判（可操作 / 特异性 / 非梗概 / 状态落纸 / 失败边界）。
| `library_combo_suggest` | inspire_start 或 chapter_brief |

### 2. 灵感段（默认）

| 工具 | 下一步 |
|------|--------|
| `inspire_start` | forge_brief |
| `inspire_forge_brief` | stage |
| `inspire_stage` / `_accept` | chapter_brief |
| `inspire_status` | — |

### 3. 写作段（默认）

| 工具 | 作用 |
|------|------|
| `project_*` / `foundation_*` / `outline_*` / `chapter_*` | 作品工程 |
| `chapter_brief` | lean 开写（只吃 craft） |
| `candidate_stage` / `_accept` | 候选链 |
| `candidate_edit_brief` / `_edit_stage` / `_edit_decide` | 可选编辑过稿；A 须 confirm；B 仅候选；C 拒 |
| `candidate_accept` 旗标 `accept_after_edit`+`confirm_accept_after_edit` | 路径 A 一次确认=编辑+验收 |
| `style_lint` | **默认链工程闸**（lintPassToken） |

### 旁路（显式，非每章）

| 工具 / 旗标 | 何时 |
|-------------|------|
| `payoff_audit` / `human_feel_audit` / `novel_sense_audit` | accept 警告后细看 |
| `brief_mode=full` | 要厚 brief |
| `chapter_save` + `confirm_bypass` | 作者直写大正文 |
| `craft_only` / `skip_brief` / `strict_*` / `require_payoff` / `force` / `accept_after_edit`+confirm | 显式开关（含编辑路径 A） |
| `review_ledger` / `assemble` / `export` / `final` | 定稿与汇编 |
| `method_list` / `method_get` | 按需方法包（≠拆书卡） |

## 硬边界

- 没有 `zhizhang_generate_*`
- 持久化均须显式 accept
- 禁止 bash/Write 直改 `.zhizhang/**`
- mind ≠ lean brief 主粮；audit ≠ 默认工序


## 旁路·多草稿（0.14，默认关）

| 工具 | 说明 |
|------|------|
| `zhizhang_candidate_stage` | 可选 `draft_label` / `variant_group`；同章可多次 |
| `zhizhang_chapter_drafts` | 列某章待采纳（关着也能用） |
| `zhizhang_candidate_unify_brief` | 须开启；≥2 同章待采纳 → 整理 brief |
| `zhizhang_candidate_unify_stage` | 须开启；暂存 `source=unify` + `unifyOf`；不写正式章 |

开启：`config.multiDraft.enabled=true` 或 env `DSH_ZHIZHANG_MULTI_DRAFT=1`。默认链 nextHint **不含** unify。
