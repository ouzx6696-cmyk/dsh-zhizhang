# 状态 · dsh-zhizhang 0.10.3

> 完整认知：[COGNITION.md](./COGNITION.md)

| 项 | 事实 |
|----|------|
| 版本 | **0.10.3**（全量梳理：节奏/开篇提示、lean ending 单信号、文档对齐；承接 0.10.2 前章正文） |
| 运行时 | DeepSeek Harness 插件；Node ≥22 |
| 产品形态 | **一条闭环** + **一张调度图**（非多轮迭代拼盘） |
| 调度 | `port.scheduler` → ProductMap / SYSTEM_BRIEF / 回执 |
| 默认写作链 | **`chapter_brief(lean) → stage → lint → accept`**（未改骨架） |
| 旁路 | diagnose.audit · brief.full · save.direct · inspire.craft_only · accept.flags · finalize.ship |
| 双轴 | craft\|mind + combo；分喂不变 |
| 连续性 | 对外「当前小说状态」；lean n≥2 注入前章正文全文；accept happened 对齐正文末拍 |
| 存储 | `.zhizhang/{works,library,inspiration}`；`ledger.json` = 审校留痕（非小说状态） |
| 测试 | contracts/state-reshape + scheduler + product-loop；见 [TEST.md](./TEST.md) |
| 打包 | **未打包** |

## 质量环（不变）

- **硬闸**：lintPassToken、近期 brief、final/force、confirm_bypass
- **软传感**：Accept 一次扫（勿例行三 audit）
- **可选硬拒**：strict_* / require_payoff（旁路）
