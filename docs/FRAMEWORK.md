# 织章插件 · 框架索引

**产品**：`dsh-zhizhang`（DSH 插件）· **版本**：0.17.0  

完整认知请读 **[COGNITION.md](./COGNITION.md)**（总入口）。本页只留最小锚点，避免与分册重复。

---

## 原则

工程归代码；AI 只交创作字符串；显式 accept 才持久化。  
调度：默认最短合格，旁路显式（`port.scheduler`）。  
面板：读正文 / 对照候选 / 真采纳；产文仍归 Agent。

## 闭环一句

```text
书进库（craft|mind）→ combo → inspire → chapter_brief(lean）→ stage → lint →（可选 edit）→ accept
```

旁路含 **multi.draft（默认关）** · diagnose.audit · brief.full · save.direct · finalize 等。

## 分层一句

```text
Host → Tools（薄）→ Ports（Scheduler·三柱·Edit·MultiDraft·Gates·Quality·Methods）→ Store → .zhizhang/
     → Web seats（小说工作台默认 / 管线次级）
```

## 分册

| 要看 | 去 |
|------|-----|
| 总览与导航 | [COGNITION.md](./COGNITION.md) |
| 默认 vs 旁路 | [MAP.md](./MAP.md) |
| 三柱怎么用 | [PILLARS.md](./PILLARS.md) |
| 小说工作台 | [PANEL.md](./PANEL.md) |
| 人味/书感/brief | [QUALITY.md](./QUALITY.md) |
| 改代码从哪下手 | [CHANGE.md](./CHANGE.md) |
| 端口契约 | [PORTS.md](./PORTS.md) |
| 工具表 | [TOOLS.md](./TOOLS.md) |
| 测试 | [TEST.md](./TEST.md) |
