# dsh-zhizhang · 织章（DSH 插件）

**0.10.3**：三柱一环 + Scheduler 最短合格；续章 lean 注入前章正文全文；Agent 提示正向调教。迷路先 `zhizhang_product_map`。

DeepSeek Harness **工具型**网文工程层：**一条创作闭环**（库 → combo → 灵感 → lean 写作）。

```text
书进库（craft|mind）→ combo（1 mind+N craft）→ inspire 根基/纲 → brief(lean) → stage→lint→accept
```

| 阶段 | 状态 | 交接 |
|------|------|------|
| 拆书库 | **已上线** | 双轴卡入库 → `library_combo_suggest` |
| 灵感 | **已上线** | mind 主粮推演根基/章纲 → `inspire_accept(apply)` |
| 写作 | **已上线** | lean brief 只吃 craft → 候选门禁兑付 |

共享 **MethodRegistry** 按需注入（≠拆书卡）。人味 = 写法+状态，不灌角色声纹。

**工程归代码；AI 只负责创作内容并把成稿作为工具参数提交；显式 accept 才持久化。**

## 安装

```bash
cd /path/to/dsh-zhizhang
npm install          # prepare → tsc → dist/
dsh plugin --profile web add link:$(pwd)
# 重启 profile；确认配置中出现 zhizhang 层
```

需要 **Node ≥22**。细节：[docs/DSH_INSTALL.md](docs/DSH_INSTALL.md)

## 闭环路径

```text
库：import → dissect_brief → card_stage(axis) → card_accept → combo_suggest
灵感：inspire_start(card_ids) → forge_brief → stage → accept(apply?)
写作：chapter_brief(lean) → candidate_stage → style_lint → candidate_accept
```

迷路先看：`zhizhang_product_map`。

## 哲学

| 归代码 | 归 AI |
|--------|--------|
| 落盘、锁、原子写、路径沙箱 | 大纲措辞、正文、改稿、拆书分析 |
| 门禁（Ports）、雷达、兑付审计 | 把成稿作为**工具参数**提交 |
| 候选 stage / accept、审校留痕 | 五类证据**诊断**（写入 ledger） |
| final 拒覆盖、禁止双采纳 | **不**直接碰磁盘、**不**自称已写库 |

## 文档（认知层）

从这一份开始读懂全局：**[docs/COGNITION.md](docs/COGNITION.md)**

| 文档 | 内容 |
|------|------|
| [docs/COGNITION.md](docs/COGNITION.md) | **总入口**：是什么、一图、分册导航 |
| [docs/MAP.md](docs/MAP.md) | 默认路径 + 显式旁路 |
| [docs/PILLARS.md](docs/PILLARS.md) | 三柱说明书 |
| [docs/QUALITY.md](docs/QUALITY.md) | 人味·书感·毒点·brief |
| [docs/CHANGE.md](docs/CHANGE.md) | 改哪里、怎么挂测 |
| [docs/PORTS.md](docs/PORTS.md) | 改进端口契约 |
| [docs/TOOLS.md](docs/TOOLS.md) | 工具一览 |
| [docs/DATA.md](docs/DATA.md) | 磁盘布局 |
| [docs/TEST.md](docs/TEST.md) | 测试分层 |
| [docs/STATUS.md](docs/STATUS.md) | 当前版本事实 |

## 冒烟

```bash
bun test
npm run typecheck
npm run build
```

版本 **0.10.3**。不默认发布 zip。安装后 `npm install` 会 prepare→build 出 `dist/`（git 不跟踪 dist）。
