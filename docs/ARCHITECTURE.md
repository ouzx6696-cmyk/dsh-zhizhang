# 架构：代码 vs AI 边界

> 总览见 [COGNITION.md](./COGNITION.md) · 改动见 [CHANGE.md](./CHANGE.md)
> 文中的 `src/...` 指**源码仓**路径；本发行包只带编译后的 `dist/`。

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
| 作品/章节 CRUD 与公开存储接口 | `src/lib/store.ts`（兼容外观） |
| 章节格式、读写与锁内更新 | `src/lib/storage/chapters.ts` |
| 作品元数据、共享锁与原子写 | `src/lib/storage/work-meta.ts`、`src/lib/storage/primitives.ts` |
| 拆书库 | `ports/library.js` + `ports/library/{schema,audit}.js` |
| 拆书分析层 | `ports/analysis/*`（facade：`ports/analysis.js`） |
| 单一事实源 | `domain/{chapter-heading,card-schema,evidence,coverage,report-sections,workflow}.js` |
| 采纳 / 前章共享服务 | `services/{accept,chapter-context}.js` |
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
