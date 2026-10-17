# 工具一览

> 认知入口：[COGNITION.md](./COGNITION.md) · 地图：[MAP.md](./MAP.md) · 策略：[PORTS.md](./PORTS.md)

调度主入口：`zhizhang_product_map`（默认 vs 旁路）。

错误对 Agent 只回短中文；本插件不内置 chat/completion。

## 默认路径（抄这一条）

```text
library_import → dissect_brief → card_stage → card_accept
  → library_combo_suggest
  → inspire_start(card_ids) → forge_brief → stage → accept(apply=true)
  → chapter_brief(lean) → 创作 → candidate_stage → style_lint →（可选 edit）→ candidate_accept
```

Accept 内嵌软传感；**不要**每章跑三 audit。

## 按闭环排列

### 0. 定位 / 调度

| 工具 | 作用 |
|------|------|
| `zhizhang_product_map` | **调度主入口**：默认路径 + 旁路 + 三阶段 |
| `zhizhang_system_brief` | 硬规则钉死 |
| `zhizhang_status` | 作品进度 + 默认下一步 |
| `zhizhang_panel_snapshot` | 面板数据口 |

### 1. 库段（默认）

| 工具 | 下一步 |
|------|--------|
| `library_import` | dissect_brief |
| `library_dissect_brief` | card_stage |
| `library_card_stage` / `_accept` | combo_suggest |
| `library_list` / `_search` / `_card_get` | combo 或 brief |
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
