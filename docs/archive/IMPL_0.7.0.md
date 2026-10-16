# IMPL 0.7.0 · 拆书库双轴重构

**时间**：2026-10-16  
**性质**：契约语义重构（ports-only）  
**备份**：`/workspace/backups/dsh-zhizhang-0.6.0-pre-dual`（未改）

## 做了什么

1. 卡硬字段 `axis: "craft" | "mind"`
2. `MindSpec`（sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract / failAsEncyclopedia）
3. bookCraft 归位为 **craft 续写面**（方案 A）
4. 分发死绑：craft → chapter_brief lean；mind → inspire forge 主粮；lean 不整段灌 mind
5. `inspire_start`：须至少一张 mind，或 `craft_only=true`
6. 准入：dissect 口令 + stage 硬拒百科/声纹/梗概；人设墙软警告
7. `kind` 降为次标签；禁止 kind=book 冒充 mind
8. 旧卡无 axis：coerce/normalize 推断；读不炸

## 未做

- 不恢复 voice 教本  
- 不把 MethodRegistry 当拆书库  
- 不加厚三 audit  
- 未打包 zip  

## 测

`bun test`：31 pass / 0 fail
