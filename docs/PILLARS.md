# 三柱说明书 · Library · Inspiration · Writing

> 三柱 = 闭环三段工序。共享 **MethodRegistry**（方法包 ≠ 拆书卡）。

---

## ① 拆书库 · LibraryPort（live）

**做什么**：用户交书 → 定档（Auto 10% / Full 须同意）→ 分批读 → 白描事实 → 聚合 → 暂存卡 → 显式 accept → 报告；再 **combo** 组包。

**落盘**：`.zhizhang/library/{sources,cards,candidates,index.json}`

### 双轴

| axis | 主填 | 喂给谁 | 不做什么 |
|------|------|--------|----------|
| **craft** | `humanFeel`（写法+状态）+ `bookCraft`（章级继续为何） | lean `chapter_brief` | 不抄情节链；不灌声纹 |
| **mind** | `MindSpec`（卖点进代价、信息分期、压力机、长线债、读者合同…） | inspire forge → foundation/outline | **不**整段灌 lean 正文 brief |

`kind`（craft|scene|book）只是次标签；**禁止**用 `kind=book` 冒充 mind。

### 卡字段要点（craft）

- `writerCraft`：场面取舍 / 信息怎么漏 / 节奏或小物；可写**打碎逻辑名** + 本书载体  
- `characterState`：**这一刻**场面状态（慌、赖、在算…）— **非**人设墙、**非**声纹  
- `stateOnPage` / `allowedEdges`（**本场应落纸**的不完美）/ `failAsTemplate`（僵硬范文版）  
- `bookCraft.continueWhy`：收束后为何还想翻；`failAsShortStory`  
- **反僵硬**：迁打碎逻辑，不迁场面外壳；不同书载体各自不同（见 [QUALITY.md](./QUALITY.md)）

### 卡字段要点（mind）

- `sellIntoCost` · `infoStaging` · `pressureMachine` · `debtAndSwap` · `readerContract` · `failAsEncyclopedia`

### 准入（硬拒）

- 世界观百科 / 原作名词词条  
- 剧情梗概当技法  
- 角色声纹 / 台词范本 / 口气正例教嘴  
- 泛人设清单墙  

缺证据块可软警告过 stage；**明显百科/声纹硬拒**。空 body 拒。stage **不**写 `cards/`；须 accept 才入库。

### 默认工序

```text
library_import → library_plan（Auto 10% 分层 / Full 须作者同意）
  → library_dissect_brief(batch)（真读原文）→ library_facts_stage（白描）
  → library_structure_stage（剧情/节奏/人物）→ library_card_stage(v2)
  → 读 stage 软警告 → library_card_accept（答判断面）
  → library_report → library_combo_suggest
```

### combo

- 输出：**恰好 1 mind + ≤N craft**（可跨书）的 `card_ids`（mind 在前）  
- 过滤：`sourceId` / `sourceIds` / `sourceTitle` / `axis`  
- 下游：整包给 `inspire_start`；lean brief 只注入其中 craft  

---

## ② 灵感推演 · InspirationPort（live）

**做什么**：选用已采纳卡 → forge（分喂）→ stage 根基/章纲候选 → 显式 accept；**可选** `apply=true` 写入作品。

**落盘**：`.zhizhang/inspiration/{sessions,candidates}`

### 默认工序

```text
inspire_start(card_ids) → inspire_forge_brief → inspire_stage
  → inspire_accept(apply=true) → chapter_brief
```

### 规则

| 规则 | 说明 |
|------|------|
| 卡须已 accept | 未入库卡不能开会话主粮 |
| 参考卡 | 可无卡直接按作者目标规划；有卡但无 `axis=mind` 时须显式 `craft_only=true`（旁路） |
| 节奏 | 可选择快爽 / 稳推 / 慢燃；未指定时依据作者目标选择并说明 |
| 分喂 | **mind 主粮** → planned/locks/threads；**craft 辅** → style/场面，勿当设定替身 |
| 不静默写作品 | 只有 `acceptEmit(apply=true)` 才调 store foundation/outline |
| 禁止声纹教嘴 | outline `stateLens` = 场面状态/写法取舍，非声纹 |

`resolveCardsForBrief`：explicit cardIds → bindings.json 绑定索引 →（旧数据）目录扫描 → none（指路 library_combo_suggest）；genre 猜卡已删。

---

## ③ 写作工程 · Writing（live）

**做什么**：作品/根基/章纲/候选/门禁/汇编。默认兑付段见 MAP 写作链。

**落盘**：`.zhizhang/works/<workKey>/` · `manuscripts/`

### 默认工序

```text
chapter_brief(lean) → 创作 → candidate_stage → style_lint →（可选 edit）→ candidate_accept
```

| 能力 | 说明 |
|------|------|
| works / foundation | 作品与根基；**当前小说状态**·已发生（accept 按纲末/正文末拍对齐短追加） |
| outline | 章纲处境（situationLens / livedScene / stateLens / ending） |
| candidates | stage → lint →（可选 edit）→ accept；token 与 brief 门禁 |
| edit（可选） | `edit_brief` → 改写 → `edit_stage` → 用户选 **A**（确认=编辑+验收）/ **B**（仅候选）/ **C**（拒/换模式）；未表态按 B；禁止静默验收 |
| gates | Brief / Lint / EditFlags + Accept 内嵌软传感 |
| assemble | 汇编成稿（**旁路** finalize.ship） |

### lean brief 吃什么

- **读者合同**（premise / planned / threads / 前章 **正文全文** + ending 索引）— 顶部始终拼；lean n≥2 注入前章 body  
- **方法**：默认仅 `style_contract`；`brief_mode=full` 才带 novel_sense/draft/tomato（旁路）  
- **卡**：只吃 craft；lean 格式 = 写法+状态（无机制全文/分析长文）  
- **mind 卡**：不灌进 lean 正文 brief  

### 旁路提醒（写作侧）

- 三 audit、厚 brief、`chapter_save`+confirm_bypass、accept 旗标、final/assemble/export — 见 [MAP.md](./MAP.md)

---

## 共享 · MethodRegistry

- 资产正文在 `method-assets.ts`；端口 `port.methods`  
- **≠** 拆书库技法卡  
- lean 默认：`style_contract`；full：四包  
- 书感长说教不要灌进 `SYSTEM_BRIEF`；按需 `method_get` 或 full brief  

三者分工：

| 来源 | 管什么 |
|------|--------|
| 技法卡 craft | 人味：写法+状态 |
| 读者合同 + novel_sense（+ full）+ bookCraft + happened | 书感 |
| MethodRegistry | 流程/文风契约方法包 |
