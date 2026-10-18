# 状态 · dsh-zhizhang 0.15.0

> 完整认知：[COGNITION.md](./COGNITION.md)

| 项 | 事实 |
|----|------|
| 版本 | **0.15.0**（统合：认知/调度/面板/文档单源 + 前端美化；能力面同 0.14） |
| 运行时 | DeepSeek Harness 插件；Node ≥22；Web client 可选 |
| 产品形态 | **一条闭环** + **一张调度图** + **小说阅读工作台**（非多轮拼盘） |
| 调度 | `port.scheduler` → ProductMap / SYSTEM_BRIEF / 面板 nextHints / 回执 |
| 默认写作链 | **`chapter_brief(lean) → stage → lint →（可选 edit）→ accept`** |
| 旁路·多草稿 | `multiDraft.enabled` / `DSH_ZHIZHANG_MULTI_DRAFT=1` → unify_*；**默认关** |
| 面板 | 三栏阅读默认；管线五区可切；编辑抉择说明卡；真采纳二次确认 |
| 编辑抉择 | A 一次确认=编辑+验收 · B 仅候选 · C 拒/换模式；未表态按 B；**禁止静默验收** |
| 旁路 | diagnose.audit · brief.full · save.direct · inspire.craft_only · accept.flags · **multi.draft** · finalize.ship |
| 存储 | `.zhizhang/{works,library,inspiration}`；`ledger.json` = 审校留痕（非小说状态） |
| HTTP 根 | 不自动跟会话 workspace（已知；非本版范围） |
| 测试 | contracts + gates + pillars；见 [TEST.md](./TEST.md) |
| 打包 | **未打包** |

## 质量环

- **硬闸**：lintPassToken、近期 brief、final/force、confirm_bypass；路径 A 另须 `confirm_accept_after_edit`；面板采纳另须 `confirm`
- **软传感**：Accept 一次扫（含人味/书感/反僵硬 tidy；勿例行三 audit）
- **可选硬拒**：strict_* / require_payoff（旁路）
- **编辑过稿**：`port.edit` + edit_brief / edit_stage / edit_decide
- **多草稿**：`port.multi_draft`；统一整理稿为普通候选（source=unify），accept 前仍须 lint
