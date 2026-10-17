# 产品地图 · 默认路径与显式旁路

> 与代码单源一致：`src/lib/ports/scheduler.ts` → ProductMap / SYSTEM_BRIEF / 工具回执。  
> 运行时看：`zhizhang_product_map`。

---

## 默认 DEFAULT — 最短合格

整条闭环：

```text
书进库（craft|mind）
  → library_combo_suggest（1 mind + N craft，可跨书）
  → inspire 落根基/纲
  → chapter_brief(lean，只吃 craft）
  → candidate_stage → style_lint →（可选 edit）→ candidate_accept
```

### 三段工序

| 段 | 链 | 说明 |
|----|-----|------|
| **库** | `library_import → dissect_brief → card_stage → card_accept → combo_suggest` | 双轴卡入库；combo 交出 `card_ids` |
| **灵感** | `inspire_start(card_ids) → forge_brief → stage → accept(apply=true)` | 须至少一张 mind（或旁路 craft_only） |
| **写作** | `chapter_brief(lean) → 创作 → candidate_stage → style_lint →（可选 edit）→ candidate_accept` | Accept **内嵌**软传感；**编辑非必经**；若走编辑须用户 A/B/C；勿每章例行三 audit |

### 写作段硬闸（默认）

1. 近期 `chapter_brief`（无则 deny；`skip_brief` 为旁路）
2. `style_lint` 签发的 `lintPassToken`（已扫过 ≠ 质量过关）
3. 显式 `candidate_accept` 才写章
4. **可选编辑**：lint 后可 `edit_brief`→改写→`edit_stage`；用户选 A（`confirm_accept_after_edit`）/ B / C；未表态按 B；禁止静默验收

Accept 一次扫：Brief → Lint → Payoff → HumanFeel → NovelSense → EditFlags（路径 A）。命中默认 **warn**；`strict_*` / `require_payoff` 才硬拒（旁路）。

**当前小说状态**：accept 将 happened 与正文末拍对齐；lean brief n≥2 **注入前章正文全文**（ending/happened 作索引，不只吃纲末/章末）。工程 `ledger.json` / `review_ledger` = 审校留痕，不是小说状态。

### 常见下一步（回执同源）

| 刚做完 | 下一步提示 |
|--------|------------|
| import | dissect_brief → card_stage → card_accept → combo |
| card_accept | combo_suggest → inspire 或 chapter_brief |
| combo | inspire_start(card_ids) 或 chapter_brief(card_ids) |
| inspire apply | 写作段默认链 |
| chapter_brief | 创作 → stage → lint →（可选 edit）→ accept |
| style_lint | 可选 edit_brief→edit_stage；或直接 accept |
| edit_stage | 用户选 A/B/C（未表态按 B） |
| candidate_accept | 续章再 brief；定稿 / 诊断见旁路 |

新建作品：有卡则 combo → inspire → 写作段；无卡则 outline_set → 写作段。

---

## 旁路 BYPASS — 显式进入

旁路**不在**默认链上；Agent / 作者要主动声明何时、经由何工具。

| id | 标题 | 何时 | 经由 |
|----|------|------|------|
| `diagnose.audit` | 诊断 audit | accept 有 soft warn，或要细看兑付/人味/书感 | `payoff_audit` / `human_feel_audit` / `novel_sense_audit`（**勿例行每章**） |
| `brief.full` | 厚 brief | 要卡全文 + 四方法包 + 节拍 | `chapter_brief brief_mode=full` |
| `save.direct` | 直写章节 | 作者显式旁路候选链（大正文） | `chapter_save` + `confirm_bypass` |
| `inspire.craft_only` | 仅技法灵感 | 无 mind 卡仍要开 inspire | `inspire_start craft_only=true` |
| `accept.flags` | 采纳硬开关 | 测试或作者显式收紧/跳过 | `skip_brief` / `strict_lint` / `require_payoff` / `strict_human` / `strict_novel` / `force` |
| `finalize.ship` | 定稿与汇编 | 章末或完书 | `chapter_save status=final` · `review_ledger` · `assemble` / `export` |

---

## 分喂（地图级纪律）

- **mind** → inspire_forge / 根基·章纲  
- **craft** → chapter_brief(lean) 写法+状态（不灌角色声纹）  
- combo 的 `card_ids` 可整包给 inspire；**lean brief 自动只吃 craft**

---

## 非目标（地图上不承诺）

- 不把三阶段画成三个互不交接的产品  
- 不把 diagnose.audit 画进默认路径  
- 不在工具里另写一套「推荐链」绕过 Scheduler  
- 不声明未实现能力为 live  
