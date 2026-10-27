# 产品地图 · 默认路径与显式旁路

> 与代码单源一致：`src/lib/ports/scheduler.ts`（发行包为 `dist/lib/ports/scheduler.js`）→ ProductMap / SYSTEM_BRIEF / 工具回执。  
> 启用：普通会话先调 `zhizhang_enable`（面板常驻，不依赖启用）；启用后看 `zhizhang_product_map`。

---

## 默认 DEFAULT — 最短合格

整条闭环：

```text
书进库（craft|mind）
  → library_combo_suggest（1 book + N scene，可跨书）
  → inspire 落根基/纲
  → chapter_brief(lean，只吃 craft）
  → candidate_stage → style_lint →（可选 edit）→ candidate_accept
```

### 三段工序

| 段 | 链 | 说明 |
|----|-----|------|
| **库** | `library_import → library_plan（Auto 10% / Full 须同意）→ dissect_brief(batch) → facts → structure → card → accept → report → combo` | 双轴卡入库；combo 交出 `card_ids` |
| **灵感** | `inspire_start(card_ids) → forge_brief → stage → accept(apply=true)` | 可无参考卡直接规划；有卡但无 mind 时用 craft_only |
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
| import | plan（auto 10% / full 须同意）→ dissect_brief(batch) → facts → structure → card → accept → report → combo |
| card_accept | combo_suggest → inspire 或 chapter_brief |
| combo | inspire_start(card_ids) 或 chapter_brief(card_ids) |
| inspire apply | 写作段默认链 |
| chapter_brief | 创作 → stage → lint →（可选 edit）→ accept |
| style_lint | 可选 edit_brief→edit_stage；或直接 accept |
| edit_stage | 用户选 A/B/C（未表态按 B） |
| unify_brief / unify_stage | 仅 multi.draft 开启；整理稿仍须 lint → accept |
| candidate_accept | 续章再 brief；定稿 / 诊断见旁路 |

新建作品：有卡则 combo → inspire → 写作段；无卡可 inspire_start(goal) 规划，或 outline_set → 写作段。

---

## 旁路 BYPASS — 显式进入

旁路**不在**默认链上；Agent / 作者要主动声明何时、经由何工具。

| id | 标题 | 何时 | 经由 |
|----|------|------|------|
| `diagnose.audit` | 诊断 audit | accept 有 soft warn，或要细看兑付/人味/书感 | `payoff_audit` / `human_feel_audit` / `novel_sense_audit`（**勿例行每章**） |
| `brief.full` | 厚 brief | 要卡全文 + 四方法包 + 节拍 | `chapter_brief brief_mode=full` |
| `save.direct` | 直写章节 | 作者显式旁路候选链（大正文） | `chapter_save` + `confirm_bypass` |
| `inspire.craft_only` | 仅技法灵感 | 有 craft 但无 mind 卡，仍要仅技法试写 | `inspire_start craft_only=true` |
| `accept.flags` | 采纳硬开关 | 测试或作者显式收紧/跳过 | `skip_brief` / `strict_lint` / `require_payoff` / `strict_human` / `strict_novel` / `force` / `accept_after_edit`+confirm |
| `multi.draft` | 多草稿统一整理 | **默认关**；config.multiDraft.enabled 或 env `DSH_ZHIZHANG_MULTI_DRAFT=1`；同章≥2 待采纳 | `candidate_stage(draft_label)×N` → `unify_brief` → `unify_stage` → lint → accept |
表后补：**完书交付三步** = 逐章 `review_ledger`（审校留痕）→ `chapter_save status=final`（定稿）→ `assemble only_final=true`（出 manuscripts/<书名>.md，可反复重跑）。
**定稿后修订**：final 章拒绝候选覆盖；确需改稿用 `candidate_accept force=true`（采纳后降回 drafted，重新审校定稿）。

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


---

## 面板（Web）

- 侧栏 **织章**：默认「小说」三栏（读正文 / 对照 / 真采纳）；顶栏切「管线」看库·灵感·写作仪表。
- 写回只经面板二次确认采纳或 `zhizhang_*` 工具；与 AcceptPolicy 同源。
- 多草稿开启后可点「统一整理」（只出 brief，不写盘）。
