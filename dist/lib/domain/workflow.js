/**
 * 工作流 — 全插件唯一来源。
 * SYSTEM_BRIEF / ProductMap / 工具 description / 回执 "N/9" / 文档都从这里读。
 */
import { REPORT_SECTION_COUNT } from "./report-sections.js";
export const STORY_PACES = ["快爽", "稳推", "慢燃"];
export const AUTO_SAMPLE_HEAD = 10;
export const AUTO_SAMPLE_TAIL = 3;
export const AUTO_SAMPLE_RATIO = 0.1;
export const DISSECT_STEPS = [
    { n: 1, tool: "library_import", do: "交书（file 或 text）→ sourceId；回执看编码" },
    { n: 2, tool: "library_plan", do: "定档：auto 默认 10% 分层（前 10 章 + 后 3 章 + 等距）；full 须作者明确同意（成本回执 + confirm_token）" },
    { n: 3, tool: "library_dissect_brief(source, batch=n)", do: "按计划取本批原文（≤3 万字/批），一批一提交" },
    { n: 4, tool: "library_facts_stage", do: "逐章白描：谁做了什么、结果；没写的动机进 unknowns，禁补" },
    { n: 5, tool: "library_structure_stage", do: "聚合：plot（六项）/ rhythm（铺垫-释放-反应-衔接）/ character（面具-真相-弧光）" },
    { n: 6, tool: "library_card_stage", do: "v2 模块：layer + dimension + 5 项 + evidence；可选 steps/bannedDiction；axis 由层/维度推导" },
    { n: 7, tool: "library_card_accept", do: "5 项 + transfer/failWhen + evidence 逐条回溯；缺项/引文未命中直接拒" },
    { n: 8, tool: "library_report", do: `${REPORT_SECTION_COUNT} 节报告 + L0 量化底座（分卷/词频/热力/锚点/爽点密度）；标 Auto/Full 与覆盖率；Auto 的全书结论只作抽样观察` },
    { n: 9, tool: "library_combo_suggest", do: "1 book + N scene 组包 → inspire_start 或 chapter_brief" },
];
export const WRITE_STEPS = [
    { n: 1, tool: "chapter_brief(lean)", do: "只吃 craft + 前章正文 + 处境；full 是旁路" },
    { n: 2, tool: "（创作）", do: "按 brief 写正文；不写梗概" },
    { n: 3, tool: "candidate_stage", do: "暂存候选（不落正式章）" },
    { n: 4, tool: "style_lint(candidate)", do: "签发 lintPassToken；命中只警告，不等于质量" },
    { n: 5, tool: "（可选）edit_brief → 改写 → edit_stage → A/B/C", do: "A=编辑+验收；B=仅候选；C=拒；未表态按 B" },
    { n: 6, tool: "candidate_accept", do: "落盘正式章；回执含软传感" },
];
export const DISSECT_STEP_COUNT = DISSECT_STEPS.length;
export const WRITE_STEP_COUNT = WRITE_STEPS.length;
export const WORKFLOWS = {
    library: {
        title: `拆书入库（${DISSECT_STEP_COUNT} 步，照做）`,
        steps: DISSECT_STEPS,
        gate: "出库标准：每张卡能回答五条（可操作 / 特异性 / 非梗概 / 状态落纸 / 失败边界）；置信度拆覆盖/证据/结构三层，Auto 抽样封顶 0.84；Full 才可下全书结论。",
    },
    writing: {
        title: `写作（${WRITE_STEP_COUNT} 步，照做）`,
        steps: WRITE_STEPS,
        gate: "验收：雷达 0 ≠ 质量过关；人读一遍再定稿。",
    },
};
/** 回执/描述里的 "N/9"；未知 kind 返回空串。 */
export function stepLabel(kind, n) {
    const wf = WORKFLOWS[kind];
    if (!wf)
        return "";
    return `${n}/${wf.steps.length}`;
}
/** 工具 description 的 "【拆书 4/9 事实层】" 前缀。 */
export function stepPrefix(kind, n, label) {
    const tag = stepLabel(kind, n);
    return tag ? `【${kind === "library" ? "拆书" : "写作"} ${tag} ${label}】` : `【${label}】`;
}
