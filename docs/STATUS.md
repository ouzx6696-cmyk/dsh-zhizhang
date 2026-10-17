# 状态 · dsh-zhizhang 0.11.1

> 完整认知：[COGNITION.md](./COGNITION.md)

| 项 | 事实 |
|----|------|
| 版本 | **0.11.1**（三柱一环 + 反僵硬 + **写后可选编辑（去空转留毛边）A/B/C**） |
| 运行时 | DeepSeek Harness 插件；Node ≥22 |
| 产品形态 | **一条闭环** + **一张调度图**（非多轮迭代拼盘） |
| 调度 | `port.scheduler` → ProductMap / SYSTEM_BRIEF / 回执 |
| 默认写作链 | **`chapter_brief(lean) → stage → lint →（可选 edit）→ accept`** |
| 编辑抉择 | A 一次确认=编辑+验收 · B 仅候选再验 · C 拒/换模式；未表态按 B；**禁止静默验收**；depolish 保留毛边、反齐刷；edit_stage 可挂 `uniform_short_run` 软提示 |
| 旁路 | diagnose.audit · brief.full · save.direct · inspire.craft_only · accept.flags · finalize.ship |
| 双轴 | craft\|mind + combo；mind→灵感，craft→lean brief |
| 连续性 | 对外「当前小说状态」；lean n≥2 注入前章正文全文；accept happened 对齐正文末拍 |
| 反僵硬 | 从原书抽打碎逻辑 + 本书载体；`allowedEdges` 应落纸；lean 一行正向；`stiffness_tidy` 默认 warn |
| 存储 | `.zhizhang/{works,library,inspiration}`；`ledger.json` = 审校留痕（非小说状态） |
| 测试 | contracts（含 edit-port）+ gates + pillars；见 [TEST.md](./TEST.md) |
| 打包 | **未打包** |

## 质量环

- **硬闸**：lintPassToken、近期 brief、final/force、confirm_bypass；路径 A 另须 `confirm_accept_after_edit`
- **软传感**：Accept 一次扫（含人味/书感/反僵硬 tidy；勿例行三 audit）
- **可选硬拒**：strict_* / require_payoff（旁路）
- **编辑过稿**：`port.edit` + 工具 edit_brief / edit_stage / edit_decide；技能 [skills/web-novel-master-optimizer.md](./skills/web-novel-master-optimizer.md)
