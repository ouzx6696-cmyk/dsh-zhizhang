# 状态 · dsh-zhizhang 0.10.5

> 完整认知：[COGNITION.md](./COGNITION.md)

| 项 | 事实 |
|----|------|
| 版本 | **0.10.5**（三柱一环 + 反僵硬：打碎逻辑 / 应落纸 / stiffness_tidy；续章前章正文） |
| 运行时 | DeepSeek Harness 插件；Node ≥22 |
| 产品形态 | **一条闭环** + **一张调度图**（非多轮迭代拼盘） |
| 调度 | `port.scheduler` → ProductMap / SYSTEM_BRIEF / 回执 |
| 默认写作链 | **`chapter_brief(lean) → stage → lint → accept`** |
| 旁路 | diagnose.audit · brief.full · save.direct · inspire.craft_only · accept.flags · finalize.ship |
| 双轴 | craft\|mind + combo；mind→灵感，craft→lean brief |
| 连续性 | 对外「当前小说状态」；lean n≥2 注入前章正文全文；accept happened 对齐正文末拍 |
| 反僵硬 | 从原书抽打碎逻辑 + 本书载体；`allowedEdges` 应落纸；lean 一行正向；`stiffness_tidy` 默认 warn |
| 存储 | `.zhizhang/{works,library,inspiration}`；`ledger.json` = 审校留痕（非小说状态） |
| 测试 | contracts + gates（含 stiffness_tidy）+ pillars；见 [TEST.md](./TEST.md) |
| 打包 | **未打包** |

## 质量环

- **硬闸**：lintPassToken、近期 brief、final/force、confirm_bypass
- **软传感**：Accept 一次扫（含人味/书感/反僵硬 tidy；勿例行三 audit）
- **可选硬拒**：strict_* / require_payoff（旁路）
