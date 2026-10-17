# 织章认知总览 · dsh-zhizhang 0.11.1

> **从这一份开始读懂全局。**  
> 产品/工程对齐用；不含开发流水账。细节分册见文末导航。

---

## 1. 织章是什么

**织章**是 DeepSeek Harness（DSH）上的**工具型网文工程层**。

- **不调模型**：本插件不内置 chat/completion；AI 只通过工具交创作字符串。
- **工程归代码**：落盘、锁、门禁、审校留痕、策略 —— 在 TypeScript（经 Ports）。
- **创作归 AI**：大纲措辞、正文、改稿、拆书分析 —— 作为工具参数提交；**显式 accept 才持久化**。
- **目标**：在**质量**（人味·书感·毒点·兑付·AI腔）与**效率**（默认最短合格路径）之间，给 Agent 一条看一眼就懂的链。

一句话：

```text
书进库（双轴卡）→ combo → 灵感落根基/纲 → lean 开写 → stage→lint→（可选 edit）→ accept
```

迷路先调工具：`zhizhang_product_map`。

---

## 2. 质量 × 效率

| 维度 | 怎么落地 |
|------|----------|
| **效率** | `port.scheduler` 单源：默认最短合格；audit / 厚 brief / 直写 / 硬开关 / 定稿 全是**显式旁路** |
| **质量** | `QualityPolicy` 五轴一体（含**反僵硬**）；Accept 内嵌软传感；雷达 0 ≠ 质量过关；Agent 提示写「要写成什么样」 |
| **分喂** | mind → 设定/章纲；craft → lean brief（写法+状态）；不灌角色声纹原句 |
| **边界** | 工具薄接线；策略只改 Ports；禁止 bash 直改 `.zhizhang/**` |

---

## 3. 三角闭环（一图）

三阶段是**同一条链上的工序**，不是三个独立产品。

```text
┌─────────────┐     combo      ┌─────────────┐    apply     ┌──────────────┐
│  ① 拆书库    │ ────────────► │  ② 灵感推演  │ ──────────► │  ③ 写作工程   │
│ Library     │  1 mind+N craft│ Inspiration │  根基/章纲   │ Writing      │
│ craft|mind  │                │ mind 主粮    │              │ lean→stage   │
│ → card_ids  │                │ craft 辅     │              │ →lint→可选edit│
│             │                │              │              │ →accept      │
└─────────────┘                └─────────────┘              └──────────────┘
        ▲                                                         │
        │              MethodRegistry（共享方法包 ≠ 拆书卡）         │
        └──────────────────── 按需注入；lean 默认仅 style_contract ─┘
```

| 阶段 | 交出什么 | 下一站吃什么 |
|------|----------|--------------|
| ① 库 | 已采纳双轴卡；combo 包 `card_ids` | inspire 或（有根基时）直接 brief |
| ② 灵感 | foundation / outline（显式 apply） | chapter_brief(lean) |
| ③ 写作 | 候选正文经门禁入章（可选编辑 A/B/C） | 续章再 brief；定稿走旁路 |

默认全链（与代码 `Scheduler.defaultLine()` 一致）：

```text
书进库（craft|mind）→ library_combo_suggest（1 mind + N craft，可跨书）
  → inspire 落根基/纲 → chapter_brief(lean，只吃 craft）
  → candidate_stage → style_lint →（可选 edit）→ candidate_accept
```

---

## 4. 分层（谁干什么）

```text
Host (DSH)
  → tools.register + SYSTEM_BRIEF
  → Tools（薄：校验 · 开存储 · 调 Port · 拼回执）
  → Ports（Scheduler · ProductMap · Library · Inspiration · Edit · Gates · QualityPolicy · Methods）
  → Store + Sensors
  → .zhizhang/{works,library,inspiration,manuscripts}/
```

| 归代码 | 归 AI |
|--------|--------|
| 落盘、锁、原子写、路径沙箱 | 大纲措辞、正文、改稿、拆书分析 |
| 门禁（Ports）、雷达、兑付审计 | 把成稿作为**工具参数**提交 |
| 候选 stage / accept、审校留痕（ledger.json） | 五类证据诊断（写入 ledger） |
| final 拒覆盖、禁止双采纳 | **不**直接碰磁盘、**不**自称已写库 |

---

## 4.1 当前小说状态（连续性）

对外口径统一叫 **「当前小说状态」**。工程 `ledger.json` 只做审校留痕，不充当小说状态名。

| 组成 | 说明 |
|------|------|
| `foundation.happened` | 状态·已发生（accept 按纲末/正文末拍对齐短追加） |
| 前章 **正文全文** + ending/happened 索引 | lean n≥2 注入前章正文；ending/happened 只作索引 |
| planned / threads / locks | 合同骨 |
| 工程 `ledger.json` | **仅**审校/操作留痕，**不是**小说状态 |

物品：**只记有什么**；勿抬成「章末必须留物」硬债。毒点仍禁对账**流水**（反面教材）。

## 5. 认知分册导航

| 文档 | 一句话用途 |
|------|------------|
| **[COGNITION.md](./COGNITION.md)**（本页） | 总入口：是什么、一图、怎么读 |
| [MAP.md](./MAP.md) | 默认路径 + 显式旁路（对齐 Scheduler / ProductMap） |
| [PILLARS.md](./PILLARS.md) | 三柱说明书：库 / 灵感 / 写作 |
| [QUALITY.md](./QUALITY.md) | 创作口径：人味·书感·毒点·brief 保砍 |
| [CHANGE.md](./CHANGE.md) | 改哪里：ports-only、新能力怎么挂测 |
| [PORTS.md](./PORTS.md) | 端口契约手册（改策略时翻） |
| [TOOLS.md](./TOOLS.md) | 工具一览（按默认/旁路排） |
| [TEST.md](./TEST.md) | 测试分层与加测规则 |
| [DATA.md](./DATA.md) | 磁盘布局与卡 schema |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 代码 vs AI 边界（短） |
| [STATUS.md](./STATUS.md) | 当前版本事实快照 |
| [DSH_INSTALL.md](./DSH_INSTALL.md) | 安装到 DSH |
| [PANEL.md](./PANEL.md) | 面板数据口 |

**读法建议**

1. 产品新人：本页 → MAP → PILLARS → QUALITY  
2. 要改行为：CHANGE → PORTS → TEST  
3. Agent 迷路：工具 `zhizhang_product_map`（运行时地图 ≡ MAP 同源）

`docs/archive/`、`docs/research/` 为历史 IMPL 与调研，**不参与日常对齐**。
