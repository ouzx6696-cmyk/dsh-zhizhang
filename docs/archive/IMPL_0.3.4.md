# IMPL 0.3.4 · 书感 novel_sense + 本书读者合同

**版本**：dsh-zhizhang 0.3.4  
**基线**：0.3.3（人味卡 + forge/brief 注入 + 范文腔软雷达）  
**范围**：仅阶段 **0.3.4**（见 `NOVEL_SENSE_DEEP_PLAN.md` §4）— **未做** 0.3.4b bookCraft / 0.3.5 续写强制 / 0.3.6 书感闸；未打包。

## 改动

1. **MethodRegistry 资产 `novel_sense`**（`src/lib/method-assets.ts`）
   - 短中文：你在写长篇/连载的一章；消耗前结果；留书债；相邻须变
   - 失败样：独立短篇闭环 / 同骨架再演示设定
   - 与人味分工：人味归拆书卡；书感归本资产 + brief 合同

2. **`CHAPTER_BRIEF_ASSET_IDS`**
   - 默认：`novel_sense` · `style_contract` · `draft` · `tomato_four_q`（共 4）

3. **`formatReaderContract` + `MethodRegistry.formatReaderContract`**
   - brief 顶部 **「本书读者合同」**：premise / planned / threads（截断）/ happened（有则）/ 本章 ending
   - n≥2（按 position）：注入前章 ending + 文末摘录

4. **`zhizhang_chapter_brief`**
   - 顶部拼读者合同；工程提醒区分书感/人味/流程
   - 根基区缩为锁定/文风（计划与伏笔升格进合同）

5. **版本**：package / ProductMap → **0.3.4**；STATUS / FRAMEWORK / PORTS / TOOLS / DATA / README 同步  
   - **未**加长 SYSTEM_BRIEF 说教；未实现 bookCraft

## 验收

- `bun test`：**80** pass / 0 fail
- `npm run typecheck` / `npm run build`：绿
- brief 默认含 `novel_sense`；开篇 brief 可见「本书读者合同」；续写 brief 可见前章落点

## 未做（后续）

| 阶段 | 内容 |
|------|------|
| 0.3.4b | Library `bookCraft` / handoff；dissect「继续」口令 |
| 0.3.5 | 续写强制吃前章；accept 回写 happened |
| 0.3.6 | NovelSenseGate 软警告 |
