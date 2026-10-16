# IMPL 0.6.0 · 写法 + 状态（禁角色声纹范本）

**版本**：dsh-zhizhang **0.6.0**  
**基线**：0.5.0（备份 `/workspace/backups/dsh-zhizhang-0.5.0-20261016`）  
**产品纠正**：不向创作 AI 灌多套「角色声音」；注入 **作家写法** + **角色状态**。

## 改动

- **卡契约 `humanFeel`**：`writerCraft` / `craftRange` / `characterState` / `stateOnPage` / `allowedEdges` / `failAsTemplate`
- **兼容**：旧 `voice`/`voiceRange`/`realness` 读入时迁写；`coerceHumanFeel` 兜底落盘旧卡；`kind=voice`→`craft`
- **注入**：lean/forge 文案改为写法+状态；去掉「口气正例 / 先听口气」
- **Outline**：`voiceTone` → `stateLens`（读旧键兼容）
- **QualityPolicy**：人味轴 craft 文案对齐；HumanFeelGate 不加「学某角色嘴」硬闸
- lean 链长度不变：brief→stage→lint→accept

未打包。
