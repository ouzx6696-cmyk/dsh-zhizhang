/** Resident hard rules — default route from Scheduler; bypasses explicit. */
import { Scheduler } from "../lib/ports/scheduler.js";

export const SYSTEM_BRIEF = `【织章 / zhizhang 硬规则 — 调度一眼看懂；工程归代码，创作归 AI】
0. **默认路径（最短合格）**：${Scheduler.defaultLine()}
   写作段：zhizhang_chapter_brief(lean) → 创作 → zhizhang_candidate_stage → zhizhang_style_lint(candidate) → zhizhang_candidate_accept。
   Accept 已内嵌软传感；audit 仅诊断旁路（accept 回执有 warn 或作者要细看时再用）。
1. **旁路（显式）**：diagnose.audit · brief.full · save.direct · inspire.craft_only · accept.flags · finalize.ship。细则：zhizhang_product_map。
2. **落盘**：正文与卡/灵感经 stage→lint→accept 落盘；.zhizhang 创作树只经本插件工具写入；大正文旁路 chapter_save 须 confirm_bypass。
3. **双轴**：craft=写作技法（写法+场面状态→lean brief）；mind=创作思维（→inspire 设定/纲）。技法卡 ≠ MethodRegistry。入库写可迁移的写法或创作思维。
4. **库→灵感**：library_* → combo_suggest → inspire_*（须 mind 或 craft_only）→ 再开写。lean brief 只吃 craft。开写走 brief→stage→lint→accept。
5. **工程硬闸**：accept 须 lintPassToken（已扫过≠质量过关）+ 近期 chapter_brief（skip_brief 旁路）。命中>0 默认警告；strict_* / require_payoff 为旁路硬拒。
6. **当前小说状态**：n≥2 brief 注入前章**正文全文**（ending/happened 作索引）；accept 按纲末/正文末拍对齐追加 happened。相邻章换压力推进。书债=场面未了。
7. **定稿旁路**：final 章改稿须 force；review_ledger + chapter_save status=final；assemble/export 章末再跑。
8. **迷路**：先 zhizhang_product_map（含调度图），再 system_brief / status。本插件不调模型；只把创作字符串作工具参数提交。`;
