/** Resident hard rules — default route from Scheduler; bypasses explicit. */
import { Scheduler } from "../lib/ports/scheduler.js";
import {
    AUTO_SAMPLE_HEAD,
    AUTO_SAMPLE_RATIO,
    AUTO_SAMPLE_TAIL,
    DISSECT_STEP_COUNT,
    DISSECT_STEPS,
    WRITE_STEP_COUNT,
    WRITE_STEPS,
} from "../lib/domain/workflow.js";
import { REPORT_SECTION_COUNT } from "../lib/domain/report-sections.js";
import { PLUGIN_VERSION } from "../lib/version.js";

const WORKFLOW_BLOCK = [
    "【工作流（照做，别跳步；回执里的“下一步 N/9”与此同号）】",
    `拆书 ${DISSECT_STEP_COUNT} 步（${PLUGIN_VERSION}）：` + DISSECT_STEPS.map((s: any) => `${s.n}) ${s.tool} —— ${s.do}`).join(" → "),
    `写作 ${WRITE_STEP_COUNT} 步：` + WRITE_STEPS.map((s: any) => `${s.n}) ${s.tool} —— ${s.do}`).join(" → "),
    `Auto 是抽样：全书结论只作「抽样观察」；只读开头只出「快速预览」。`,
].join("\n");

export const SYSTEM_BRIEF = `【织章 / zhizhang 硬规则 — 调度一眼看懂；工程归代码，创作归 AI；本段仅在 zhizhang_enable 后注入本会话】
0. **默认路径（最短合格）**：${Scheduler.defaultLine()}
   写作段：zhizhang_chapter_brief(lean) → 创作 → zhizhang_candidate_stage → zhizhang_style_lint(candidate) →（可选 edit）→ zhizhang_candidate_accept。
   可选编辑：edit_brief → 改写 → edit_stage → 用户选 A（confirm=编辑+验收）/ B（仅候选）/ C（拒/换模式）；未表态按 B；禁止静默验收。
   可选多草稿（默认关）：同章多次 stage(draft_label) → unify_brief → unify_stage → lint → accept；开 config.multiDraft.enabled 或 DSH_ZHIZHANG_MULTI_DRAFT=1。
   Web：侧栏织章默认小说工作台（读/对照/真采纳）；产文仍归 Agent 工具。
   Accept 已内嵌软传感；audit 仅诊断旁路（accept 回执有 warn 或作者要细看时再用）。
1. **旁路（显式）**：diagnose.audit · brief.full · save.direct · inspire.craft_only · accept.flags · multi.draft（默认关）· finalize.ship。细则：zhizhang_product_map。
2. **落盘**：正文与卡/灵感经 stage→lint→accept 落盘；.zhizhang 创作树只经本插件工具写入；大正文旁路 chapter_save 须 confirm_bypass。
3. **双轴**：craft=写作技法（写法+场面状态→lean brief）；mind=创作思维（→inspire 设定/纲）。技法卡 ≠ MethodRegistry。入库写可迁移的写法或创作思维。
4. **库→灵感**：library_* → combo_suggest → inspire_*（须 mind 或 craft_only）→ 再开写。lean brief 只吃 craft。开写走 brief→stage→lint→（可选 edit）→accept。
5. **工程硬闸**：accept 须 lintPassToken（已扫过≠质量过关）+ 近期 chapter_brief（skip_brief 旁路）。命中>0 默认警告；strict_* / require_payoff 为旁路硬拒。路径 A 另须 accept_after_edit + confirm_accept_after_edit。
6. **当前小说状态**：n≥2 brief 注入前章**正文全文**（ending/happened 作索引）；accept 按纲末/正文末拍对齐追加 happened。相邻章换压力推进。书债=场面未了。
7. **定稿旁路**：final 章改稿须 force；review_ledger + chapter_save status=final；assemble/export 章末再跑。
8. **拆书验收（真读，不看脚本）**：引文能搜到、字段齐全、audit 通过——只证明没编、没缺，不证明卡能用。五条判据：可操作 / 特异性（换书名还成立=没抓到本书）/ 非梗概 / 状态落纸 / 失败边界具体；mind 卡另须一句「检验方法」。library_audit 只诊断机械面，通过≠合格。拆书先定档：**Auto 默认按字数 ${Math.round(AUTO_SAMPLE_RATIO * 100)}% 分层抽样**（前 ${AUTO_SAMPLE_HEAD} 章 + 后 ${AUTO_SAMPLE_TAIL} 章 + 等距）；**Full 全量须作者明确同意**（先看成本回执，再传 confirm_token），不得代作者决定。
9. **迷路**：先 zhizhang_product_map（含调度图），再 system_brief / status。本插件不调模型；只把创作字符串作工具参数提交。编辑技能见 docs/skills/web-novel-master-optimizer.md。
${WORKFLOW_BLOCK}
报告固定 ${REPORT_SECTION_COUNT} 节：节清单见 domain/report-sections.js，不再手写 19/22。`;
