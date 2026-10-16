# IMPL 0.5.0 · lean 默认链

**版本**：dsh-zhizhang **0.5.0**  
**基线**：0.4.0（QualityPolicy）  
**范围**：质量×效率 — 砍低杠杆注入与例行三 audit；保幕+上一章连续性；voice 正例提前。

## 改动

- `chapter_brief` 默认 `brief_mode=lean`；`full` 保留厚 brief
- 卡 lean：`formatTechniqueCardBlockLean`（voice/毛边/fail + continueWhy/adjacent）
- `renderOutlineLean`（无 beats）
- 读者合同 lean：短 planned/threads；默认不灌前章长摘录
- `CHAPTER_BRIEF_ASSET_IDS = ["style_contract"]`
- SYSTEM_BRIEF / ProductMap：最短链 4 步；audit=诊断
- 契约：`test/contracts/brief-lean.test.ts`

未打包。真机见评测侧 LIVE_V41_LEAN。
