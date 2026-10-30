/**
 * ProductMap — one creative loop + scheduler surface (default vs bypass).
 */
import { InspirationPort } from "./inspiration.js";
import { LibraryPort } from "./library.js";
import { MethodRegistry } from "./methods.js";
import { QualityPolicy } from "./quality-policy.js";
import { VERSION } from "../../../../core/src/version.js";
import { SCHEDULER_DEFAULT_LINE, Scheduler, } from "./scheduler.js";
import { WORKFLOWS } from "../domain/workflow.js";
/** Canonical one-liner — identical to Scheduler.defaultLine(). */
export const CREATIVE_LOOP_LINE = SCHEDULER_DEFAULT_LINE;
let toolCount = 0;

export const ProductMap = {
    id: "port.product",
    version: VERSION,
    /** 运行时由 index.js 注入真实工具数；文档/面板不再硬编码 47/51/52。 */
    setToolCount(n: number) {
        toolCount = Number(n) || 0;
        return toolCount;
    },
    toolCount() {
        return toolCount;
    },
    loopLine() {
        return Scheduler.defaultLine();
    },
    pillars() {
        return [
            {
                id: LibraryPort.id,
                title: LibraryPort.title,
                status: LibraryPort.status,
                summary: LibraryPort.summary,
                capabilities: LibraryPort.capabilities(),
                loopStage: 1,
                handsOffTo: Scheduler.nextHint("library_card_accept"),
            },
            {
                id: InspirationPort.id,
                title: InspirationPort.title,
                status: InspirationPort.status,
                summary: InspirationPort.summary,
                capabilities: InspirationPort.capabilities(),
                loopStage: 2,
                handsOffTo: "inspire_accept(apply=true) → " + Scheduler.writeLine(),
            },
            {
                id: "port.writing",
                title: "写作工程",
                status: "live",
                summary: "默认兑付段：" +
                    Scheduler.writeLine() +
                    "；audit/assemble/直写均为旁路（见调度图）。",
                capabilities: [
                    { id: "works", title: "作品根基、作者记录与版本化接续索引", ready: true },
                    { id: "outline", title: "章纲处境", ready: true },
                    { id: "candidates", title: "候选 stage/accept", ready: true },
                    { id: "edit", title: "按需编辑与工作稿采纳", ready: true },
                    { id: "multi_draft", title: "可选多草稿+统一整理（默认关）", ready: true },
                    { id: "gates", title: "Brief/Lint + Accept 内嵌软传感", ready: true },
                    { id: "assemble", title: "汇编现行正文（不改变定稿状态）", ready: true },
                ],
                loopStage: 3,
                handsOffTo: Scheduler.nextHint("candidate_accept"),
            },
        ];
    },
    methods() {
        return {
            registry: "port.methods",
            count: MethodRegistry.list().length,
            briefDefaultIds: [...MethodRegistry.briefDefaultIds],
            note: "共享方法包（≠拆书卡）。lean brief 默认仅 style_contract；full 为旁路 brief.full。",
        };
    },
    formatForAgent() {
        const lines = [
            `# 长篇产品地图 · ${ProductMap.version}`,
            "",
            "## 一条创作闭环",
            ProductMap.loopLine(),
            "",
            "三个阶段服务同一部作品，按最终产物进入，不要求自动三连跑。片段分析用 fanqie_reference_analyze，可保留工作区迁移包；正式入库再用 library_*。",
            "",
            Scheduler.formatDiagram(),
            "",
            `## 工具面（${toolCount || "?"} 个）`,
            "",
            "## 闭环三阶段",
        ];
        for (const p of ProductMap.pillars()) {
            const tag = p.status === "live" ? "已上线" : "预留";
            lines.push(`### ${p.loopStage}. ${p.title}（${tag}）`);
            lines.push(p.summary);
            lines.push(`- 交接：${p.handsOffTo}`);
            for (const c of p.capabilities) {
                lines.push(`- [${c.ready ? "✓" : "·"}] ${c.title}（${c.id}）`);
            }
            lines.push("");
        }
        lines.push("## 按任务取用的工作流");
        for (const wf of Object.values(WORKFLOWS)) {
            lines.push(`### ${wf.title}`);
            for (const st of wf.steps)
                lines.push(`${st.n}. ${st.tool} —— ${st.do}`);
            lines.push(`- 闸：${wf.gate}`);
            lines.push("");
        }
        const m = ProductMap.methods();
        lines.push("## 共享方法资产（MethodRegistry）");
        lines.push(m.note);
        lines.push(`- 数量：${m.count} · brief 默认：${m.briefDefaultIds.join("、")}`);
        lines.push("");
        lines.push("## 分喂纪律");
        lines.push("- **mind** → inspire_forge / 根基·章纲");
        lines.push("- **craft** → chapter_brief(lean) 写法+场面状态");
        lines.push("- combo 的 card_ids 可整包给 inspire；lean brief 自动只吃 craft");
        lines.push("- 编辑按真实问题与授权；A/B/C 为兼容交互，不重复索取固定确认词。采纳工作稿后，内容审读与定稿分别核对；方法见 fanqie_method_get ids=edit");
        lines.push("- 可选·多草稿（默认关）：同章多候选 → unify_brief → unify_stage；开 WRITER_NOVEL_MULTI_DRAFT=1 或 config.multiDraft.enabled；默认链不加负重");
        lines.push("- Web 面板：侧栏写作台默认三栏阅读工作台；管线可切；真采纳同 Accept；产文仍归 Agent");
        lines.push("");
        lines.push("## 质量面（QualityPolicy）");
        lines.push(QualityPolicy.surfaceLine());
        lines.push("入库写可迁移的写法或创作思维。雷达 0 ≠ 质量过关。");
        return lines.join("\n");
    },
};
