# 创作口径 · 人味 · 反僵硬 · 书感 · 毒点 · Brief

> 质量面单源：`port.quality`（QualityPolicy）。  
> 五轴一体，不是三套互相打架的产品。

---

## 质量面一览

| 轴 | 工艺输入 | 软传感 |
|----|----------|--------|
| **人味** feel | craft 卡：`writerCraft` + `characterState` + 毛边 / failAsTemplate（**≠ 角色声纹**） | HumanFeelGate |
| **书感** book | 读者合同 + novel_sense + bookCraft + 前章正文/happened | NovelSenseGate |
| **毒点** poison | 本政策（设定与正文共用） | HumanFeel 毒点码 |
| **兑付** payoff | 章纲 ending + tomato_four_q + draft | PayoffGate / payoff_audit |
| **AI腔** style | style_contract（lean brief 默认已载） | StyleLinterPort |

**铁律**：雷达 0 ≠ 质量过关；禁词命中默认 warn，不默认升级为质量法硬拒。

---

## 人味 = 写法 + 状态

**调教原则**：Agent 可见提示写「要写成什么样」；叠「不要xx」会提醒旧坏法。工程硬闸仍拦台词范本教嘴。

| 写成 | 样子 |
|------|------|
| 作家怎么写这一场（取舍、漏信息、节奏、小物） | 可迁到另一本书正文的写法 |
| 这一刻人物**场面状态**（慌、赖、在算） | 非人设标签墙 |
| 状态落到纸上的手法；允许毛边 | 有活人晃动 |

lean brief 只注入 craft 的写法+场面状态。

---


## 反僵硬（打碎完美感，不是每书套一种场面）

目标：打碎 AI 那种**完美、僵硬**的文字（句句收齐、反应全对、讲义说明、意义被作者收完）。

| 从原书抽什么 | 怎么落地 |
|--------------|----------|
| **打碎逻辑**（书无关：呼吸不齐、半截念头、信息侧漏、错半拍、余震、拧着说…） | craft `writerCraft` / 卡面写清逻辑名 |
| **本书载体**（这一本自己怎么打散，不是通用出丑处方） | 同场具体写法，换书不硬套外壳 |
| **本场应落纸** | `allowedEdges` 写成「本场应落纸：…」，勿写「可以/允许…」许可句 |
| **僵硬即失败** | `failAsTemplate` 点名范文版 |

有打碎向 craft 时 lean brief 追加一行反僵硬正向；Accept 内 `stiffness_tidy` 默认 **warn**（卡未承诺打碎则不扫）。口气可散，**卖点节拍不能散**。

## 书感

- 写的是**长篇/连载的一章**  
- 收束后还要有「为何翻下一页」（bookCraft.continueWhy / 书债）  
- 书债 = **场面未了**的开放压力（书债线索故意排除对账/账页等流水词，避免诱发记账体）  
- 相邻章换压力推进；n≥2 brief 注入前章 **正文全文**（ending/happened 作索引）；accept 按纲末/正文末拍对齐追加 happened  
- 物品随场面自然带着即可（不抬成硬债）  

NovelSense 软雷达：同构再演示 / 无书债 / 过闭环；默认 warn；`strict_novel` 旁路硬拒。

---

## 毒点（设定与正文共用写法）

政策原文（单源 · 正向）：

> 质量写法：细节与代价嵌进动作与当场压力；顿号多件收获写成带阻力的场面；账与数字只当这一刻的压力线索；生活琐事留一件有戏的；物件随场面自然带着。

传感码：`setting_enum_dump` / `ledger_dump` / `domestic_trivia`（做人味软雷达的一部分；拒收回显写正向改法）。

---

## Brief：保什么 · 砍什么

### lean（默认）

开篇 brief 带「先尝卖点、设定嵌动作」正向句；续章仍以注入的前章正文为准。lean 本章 ending 只在处境区出现一次。

| 保 | 砍 |
|----|-----|
| 本书读者合同（premise / planned / threads / 前章正文全文+ending 索引） | 四方法包全文（novel_sense/draft/tomato） |
| craft 卡 lean 块：写法+状态 | 卡 mechanisms 全文、分析 body 长文 |
| style_contract（含句长起伏） | mind 卡整段灌入 |
| 写法提醒一行 | 节拍长说教 |

### full（旁路 `brief_mode=full`）

卡全文倾向 + 四方法包 + 更厚节拍；**仅当作者/Agent 显式要厚 brief**。

---

## Accept 一次扫（默认）

顺序：BriefGate → LintGate → PayoffGate → HumanFeelGate → NovelSenseGate。

| 默认 | 旁路硬拒 |
|------|----------|
| lint 命中 >0 → warn | `strict_lint` |
| 人味/书感命中 → warn | `strict_human` / `strict_novel` |
| 兑付软警告 | `require_payoff` |
| 无近期 brief → deny | `skip_brief` 才跳过 |

诊断细看：三 audit 工具（旁路 diagnose.audit），**不签发** lint token，不替代默认链。
