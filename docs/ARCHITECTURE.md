# 架构：代码 vs AI 边界

> 总览见 [COGNITION.md](./COGNITION.md) · 改动见 [CHANGE.md](./CHANGE.md)

## 一句话

**工程状态机、锁、落盘、门禁、语感规则、兑付审计、审校留痕、采纳写回 —— 在插件 TypeScript（优先经 Ports）；大模型只通过 DSH Agent 调用工具，提交创作字符串，从不直接碰磁盘。**

产品形态：**一条创作闭环** + **Scheduler 调度**（默认最短合格 vs 显式旁路）。

```text
Host (DSH) → apply / tools.register
     → src/tools/*（按域薄接线）
     → Ports（Scheduler + 三柱 + Edit(可选) + Gates + Quality + Methods）
     → Store + Sensors
     → .zhizhang/{works,library,inspiration,manuscripts}/
```

## 代码负责（确定性）

| 能力 | 位置 |
|------|------|
| 作品/章节 CRUD、原子写、路径沙箱 | `src/lib/store.ts` |
| 拆书库 | `ports/library.ts` |
| 灵感会话/推演/可选 apply | `ports/inspiration.ts` |
| 默认路径 vs 旁路 | `ports/scheduler.ts` |
| 可选编辑过稿（A/B/C） | `ports/edit.ts` |
| 采纳/旁路/brief/payoff 策略 | `src/lib/ports/*` |
| 质量面 | `ports/quality-policy.ts` |
| 闭环产品地图 | `ports/product.ts` ← `zhizhang_product_map` |
| AI 腔 / 兑付传感 | `style-linter.ts` / `payoff-audit.ts` ← Audit ports |
| 方法资产按需注入 | `method-assets.ts` ← MethodRegistry |
| 常驻硬规则 | `SYSTEM_BRIEF` + `systemPrompt.section` |

## AI 负责（创造性）

- 写大纲措辞、正文、改稿建议、技法卡分析正文  
- 把成稿 / 卡 / 灵感候选作为参数交给对应 `*_stage` 工具  
- 显式 `*_accept` 后才持久化；不自称已写库  
- 按五类证据做诊断（写入 ledger）；插件不提供「代写替换段」工具  

## 面板

`zhizhang_panel_snapshot` 导出进度/处境/候选/审校留痕；不做第二套编辑器写库路径。见 [PANEL.md](./PANEL.md)。
