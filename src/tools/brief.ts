/** Resident hard rules — default route from Scheduler; bypasses explicit. */
import { Scheduler, SCHEDULER_BYPASSES } from "../lib/ports/scheduler.js";
import {
    AUTO_SAMPLE_HEAD,
    AUTO_SAMPLE_RATIO,
    AUTO_SAMPLE_TAIL,
    DISSECT_STEP_COUNT,
    DISSECT_STEPS,
    WRITE_STEP_COUNT,
    WRITE_STEPS,
} from "../lib/domain/workflow.js";

const WORKFLOW_BLOCK = [
    `【工作流】拆书 ${DISSECT_STEP_COUNT} 步：${DISSECT_STEPS.map((s: any) => s.tool).join(" → ")}；`,
    `写作 ${WRITE_STEP_COUNT} 步：${WRITE_STEPS.map((s: any) => s.tool).join(" → ")}。`,
    "每步做什么看该工具描述与回执里的「下一步 N/9」（与本行同号）；Auto 是抽样，全书结论只作「抽样观察」。",
].join("");

export const SYSTEM_BRIEF = `【织章 / zhizhang 硬规则 — 工程归代码，创作归 AI；仅 zhizhang_enable 后注入本会话】
0. **默认路径（最短合格）**：${Scheduler.defaultLine()}
   - 写作段：zhizhang_chapter_brief(lean) → 创作 → zhizhang_candidate_stage → zhizhang_style_lint(candidate) →（可选 edit）→ zhizhang_candidate_accept。
   - 可选 edit：lint 后 edit_brief → 改写 → edit_stage → 用户选 A（confirm=编辑+验收）/ B（仅候选）/ C（拒/换模式）；未表态按 B；禁止静默验收。
1. **旁路（显式才走）**：${SCHEDULER_BYPASSES.map((b: any) => b.id).join(" · ")}。何时/经由见 zhizhang_product_map。
2. **落盘**：正文候选走 stage→lint→accept；卡与灵感候选各自 stage→accept，灵感 apply=true 才写作品；.zhizhang 创作树只经本插件工具写入；大正文旁路 chapter_save 须 confirm_bypass。多草稿默认关（开：config.multiDraft.enabled 或 DSH_ZHIZHANG_MULTI_DRAFT=1）。Web 侧栏织章=读与真采纳，产文仍归工具。
3. **双轴分喂**：craft=写法+场面状态（→ lean brief，只吃 craft）；mind=创作思维（→ inspire 设定/纲）。链路：library_* → library_combo_suggest → inspire_* → 开写。技法卡 ≠ MethodRegistry 方法包。
4. **工程硬闸**：accept 须 lintPassToken（已扫过≠质量过关）+ 近期 chapter_brief（skip_brief 旁路）；strict_* / require_payoff 为显式硬拒开关；路径 A 另须 confirm_accept_after_edit。Accept 已内嵌软传感；三个 *_audit 仅诊断旁路。
5. **当前小说状态**：n≥2 brief 注入前章**正文全文**（ending/happened 作索引）；accept 按纲末/正文末拍对齐追加 happened；相邻章换压力推进；书债=场面未了。
6. **定稿（旁路）**：final 章改稿须 force；review_ledger + chapter_save status=final；assemble 章末再跑。
7. **拆书验收（真读，不看脚本）**：脚本通过只证明没编没缺，不证明卡能用。五条判据：可操作 / 特异性（换书名还成立=没抓到本书）/ 非梗概 / 状态落纸 / 失败边界具体；mind 卡另须一句「检验方法」。定档：**Auto 默认按字数 ${Math.round(AUTO_SAMPLE_RATIO * 100)}% 分层抽样**（前 ${AUTO_SAMPLE_HEAD} 章 + 后 ${AUTO_SAMPLE_TAIL} 章 + 等距；小书全读）；**Full 全量须作者明确同意**（先看成本回执再传 confirm_token），不得代作者决定。
8. **操作中断**：不要重复操作；章节保存、候选暂存、扫描、采纳或留痕用 zhizhang_status(work=…, recovery=inspect)，书源导入、拆书计划或分析、卡入库或删卡用 zhizhang_library_list(recovery=inspect)，灵感应用用 zhizhang_inspire_status(recovery=inspect)；确认无冲突后才用同一工具 recovery=resume。
9. **迷路**：先 zhizhang_product_map（调度全图），再 zhizhang_system_brief / zhizhang_status。本插件不调模型；只把创作字符串作为工具参数提交。
${WORKFLOW_BLOCK}`;
