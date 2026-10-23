/**
 * 拆书报告 — 19 节固定清单，逐节纯渲染。
 *
 * 设计：
 * - 节数只由 REPORT_SECTIONS 决定；不再手写 1b/4b/9b/覆盖率这类「第 20 节」。
 * - 每一节都必须能在空数据下渲染；短书/空书不出现 -Infinity、不补幻影章。
 * - §14 列全部已采纳卡（v1 + v2）；v1 由调用方用 toCardView 适配，这里只打版本标签。
 */
import { REPORT_SECTIONS } from "../../domain/report-sections.js";
import { AUTO_CONFIDENCE_CAP } from "../../domain/coverage.js";
import { nowIso } from "./paths.js";
import { planLabel } from "./plan.js";
function mdTable(head, rows) {
    const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    return [
        `| ${head.join(" | ")} |`,
        `| ${head.map(() => "---").join(" | ")} |`,
        ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
    ].join("\n");
}
function section(n) {
    const hit = REPORT_SECTIONS.find((s) => s.n === n);
    if (!hit)
        throw new Error(`report section missing: ${n}`);
    return `## ${hit.n}. ${hit.title}`;
}
function listOr(items, empty, render) {
    return items && items.length ? items.map(render).join("\n") : empty;
}
function pct(v) {
    return `${Math.round(Number(v ?? 0) * 100)}%`;
}
function moduleTag(m) {
    return (m?.schemaVersion === 2 || m?.layer) && !m?.legacy ? "v2" : "v1";
}
export function buildReport(input) {
    const { sourceTitle, meta, facts = [], plots = [], rhythms = {}, characters = [], modules = [], coverage = {}, stats = [], benchmark, notes, plan, survey, } = input;
    const fullPlan = plan?.mode === "full";
    const planNums = new Set((plan?.chapters ?? []).map((c) => Number(c.n)));
    const planDone = plan ? facts.filter((f) => planNums.has(Number(f.n))).length : 0;
    const planOutside = plan ? facts.length - planDone : 0;
    const mark = plan
        ? fullPlan
            ? facts.length >= plan.planChapters ? "" : "（全量未完成）"
            : "（抽样观察）"
        : meta?.scope?.mode === "full" ? "" : "（早期观察）";
    const total = Number(meta?.totalChapters) || 0;
    const factByN = new Map(facts.map((f) => [Number(f.n), f]));
    const first3 = facts.filter((f) => Number(f.n) >= 1 && Number(f.n) <= 3).sort((a, b) => Number(a.n) - Number(b.n));
    const fsRows = Array.isArray(rhythms?.foreshadowing)
        ? rhythms.foreshadowing
        : Array.isArray(rhythms) && Array.isArray(rhythms[0]?.foreshadowing)
            ? rhythms[0].foreshadowing
            : [];
    const lines = [];
    lines.push(`# 拆书报告 · ${sourceTitle}`);
    lines.push("");
    lines.push(`> 生成时间：${nowIso()} · 范围：${plan ? planLabel(plan) : meta?.scope?.mode ?? "none"} · 已拆章节：${facts.length}/${total || "?"}`);
    lines.push("");
    // 1
    lines.push(section(1));
    lines.push(mdTable(["项", "值"], [
        ["书名", sourceTitle],
        ["总章数", total || "?"],
        ["档位", plan ? planLabel(plan) : "未建计划（旧模式）"],
        ["已拆章节", `${facts.length} / ${total || "?"}`],
        [plan ? "覆盖（计划）" : "本批覆盖", plan
                ? `${Math.round((planDone / Math.max(1, plan.planChapters)) * 100)}%（${planDone}/${plan.planChapters}${planOutside > 0 ? ` + ${planOutside} 计划外` : ""}）`
                : `${pct(coverage.ratio)}（${facts.length}/${coverage.scope ?? total}${Number(coverage.scope) < total ? "，样本" : ""}）`],
        ["置信度", `${coverage.confidence ?? 0}${coverage.needsReview ? " · needs_review" : ""}`],
    ]));
    lines.push("");
    lines.push("### 1.1 量化底座（代码测绘）");
    if (!survey) {
        lines.push("- 未测绘：重跑 report 会自动补（约数秒）。");
    }
    else {
        lines.push(mdTable(["项", "值"], [
            ["去空白字数", survey.totalChars],
            ["原始字符 / 行数", `${survey.rawChars} / ${survey.lines}`],
            ["章数 / 卷数", `${survey.chapterCount} / ${survey.volumes?.length ?? 0}`],
            ["平均章长", `${survey.avgChapterChars} 字（最短 ${survey.minChapterChars} / 最长 ${survey.maxChapterChars}）`],
            ["对话占比", `${Math.round((survey.dialogueRatio ?? 0) * 100)}%`],
        ]));
        if (survey.volumes?.length) {
            lines.push("");
            lines.push("#### 分卷表");
            lines.push(mdTable(["卷", "章范围", "章数", "字数", "首章", "末章"], survey.volumes.map((v) => [v.title ? `${v.name} ${v.title}` : v.name, `${v.from}–${v.to}`, v.chapters, v.chars, v.firstTitle, v.lastTitle])));
        }
        if (survey.terms?.length) {
            lines.push("");
            lines.push("#### 高频词 Top 20（人物/地名/概念混排，只作分布参考）");
            lines.push(mdTable(["词", "次数"], survey.terms.slice(0, 20).map((x) => [x.term, x.count])));
        }
        if (survey.heatmap?.rows?.length) {
            const head = ["词", ...Array.from({ length: survey.heatmap.buckets }, (_, i) => `${i * 10}–${(i + 1) * 10}%`)];
            lines.push("");
            lines.push("#### 分布热力（按章序十等分）");
            lines.push(mdTable(head, survey.heatmap.rows.map((r) => [r.term, ...r.counts])));
        }
        if (survey.anchors?.length) {
            lines.push("");
            lines.push("#### 锚点章 Top 15");
            lines.push(mdTable(["章", "标题", "分", "理由"], survey.anchors.slice(0, 15).map((a) => [a.n, a.title, a.score, a.why])));
        }
    }
    lines.push("");
    lines.push("### 1.2 覆盖率与置信度");
    lines.push(`- 事实覆盖：${facts.length}/${coverage.scope ?? total}（${pct(coverage.ratio)}）`);
    lines.push(`- 引文通过：${pct(coverage.quotePass)}`);
    lines.push(`- 结构完整：${pct(coverage.structure)}（测绘 / 剧情条 / 节奏 / 人物）`);
    lines.push(`- 模块维度：${coverage.dimensions ?? 0}/6`);
    lines.push(`- 置信度：${coverage.confidence ?? 0}${coverage.capped ? `（Auto 抽样封顶 ${AUTO_CONFIDENCE_CAP}）` : ""}${coverage.needsReview ? " · needs_review（继续拆或人读复核）" : ""}`);
    lines.push("");
    // 2
    lines.push(section(2) + mark);
    const promise = modules.find((m) => m.layer === "book" && String(m.readerWant ?? "").trim())
        ?? modules.find((m) => String(m.readerWant ?? "").trim());
    lines.push(promise ? `- 读者想看什么：${promise.readerWant}` : "- 未抽（需要 book 层模块）");
    lines.push("");
    // 3
    lines.push(section(3) + mark);
    lines.push(first3.length
        ? mdTable(["章", "标题", "钩子", "强度", "功能"], first3.map((f) => [f.n, f.title, f.hook?.type ?? "—", f.hook?.strength ?? "—", (f.functions ?? []).join("/") || "—"]))
        : "- 未拆 1–3 章");
    lines.push("");
    // 4
    lines.push(section(4) + mark);
    if (first3.length) {
        for (const f of first3)
            lines.push(`- 第${f.n}章：${(f.events ?? []).slice(0, 2).map((e) => e.desc).join("；") || "（无事实）"}`);
    }
    else {
        lines.push("- 未拆 1–3 章");
    }
    lines.push("");
    lines.push("### 4.1 开篇十章节拍");
    const openCount = Math.min(10, Math.max(1, total || 10));
    const openRows = Array.from({ length: openCount }, (_, i) => i + 1).map((n) => {
        const f = factByN.get(n);
        if (!f)
            return [n, "（未拆）", "—", "—", "—"];
        const events = f.events ?? [];
        return [f.n, f.title, `${f.hook?.type ?? "—"}/${f.hook?.strength ?? "—"}`, events[0]?.desc ?? "—", `「${String(events[events.length - 1]?.quote ?? "").slice(0, 46)}」`];
    });
    lines.push(mdTable(["章", "标题", "钩子", "首个动作", "章末引文"], openRows));
    lines.push("");
    lines.push(`- 开篇 1–${openCount} 已拆 ${openRows.filter((r) => r[1] !== "（未拆）").length}/${openCount}；缺章不补读、不替它编节拍。`);
    lines.push("");
    // 5
    lines.push(section(5) + mark);
    lines.push(listOr(plots, "- 未聚合剧情条", (p) => `- **${p.title}**（第${(p.chapters ?? []).join("、")}章）：目标=${p.goal}；阻碍=${p.obstacle}；行动=${p.action}；结果=${p.result}；意外=${p.twist}；转弯=${p.turn}`));
    lines.push("");
    // 6
    lines.push(section(6));
    lines.push(plots.length
        ? mdTable(["剧情", "章节", "目标", "阻碍", "结果", "转弯"], plots.map((p) => [p.title, (p.chapters ?? []).join("、"), p.goal, p.obstacle, p.result, p.turn]))
        : "- 未聚合");
    lines.push("");
    // 7
    lines.push(section(7) + mark);
    lines.push(rhythms?.points?.length
        ? mdTable(["章", "情绪(-1..1)", "事件"], rhythms.points.map((p) => [p.chapter, p.emotion, p.event ?? ""]))
        : "- 未记录情绪点");
    lines.push("");
    // 8
    lines.push(section(8) + mark);
    lines.push(rhythms?.loops?.length
        ? mdTable(["编号", "章节", "铺垫", "释放", "反应", "衔接"], rhythms.loops.map((l) => [l.id ?? "—", (l.range ?? []).join("–"), l.setup, l.release, l.reaction, l.transition]))
        : "- 未记录爽点循环");
    lines.push("");
    // 9
    lines.push(section(9) + mark);
    lines.push(rhythms?.hooks?.length
        ? mdTable(["章", "类型", "钩子", "强度"], rhythms.hooks.map((h) => [h.chapter, h.type, h.text, h.strength ?? "—"]))
        : "- 未记录钩子");
    lines.push("");
    lines.push("### 9.1 爽点密度");
    const hs = facts.filter((f) => f.hook?.strength);
    const cnt = (v) => hs.filter((f) => f.hook.strength === v).length;
    const ns = facts.map((f) => Number(f.n) || 0).filter((n) => n > 0);
    const span = ns.length ? Math.max(1, Math.max(...ns) - Math.min(...ns) + 1) : 0;
    const gap = (v) => {
        const c = cnt(v);
        return c && span ? (span / c).toFixed(1) : "—";
    };
    const ratioOf = (v) => `${Math.round((cnt(v) / Math.max(1, facts.length)) * 100)}%`;
    lines.push(`- 样本章 ${facts.length} · 强钩子 ${cnt("强")}（${ratioOf("强")}）· 中钩子 ${cnt("中")}（${ratioOf("中")}）· 弱钩子 ${cnt("弱")}（${ratioOf("弱")}）`);
    if (plan && plan.mode === "auto" && plan.planChapters < total)
        lines.push(`- 抽样章内平均：每 ${(facts.length / Math.max(1, cnt("强"))).toFixed(1)} 个已拆章一个强钩子（Auto 抽样，不能外推全书密度）`);
    else if (span)
        lines.push(`- 平均间隔：强钩子每 ${gap("强")} 章 / 中钩子每 ${gap("中")} 章（区间 ${span} 章）`);
    else
        lines.push("- 无有效章号：先补事实层章号，才能算钩子间隔。");
    if (survey?.volumes?.length) {
        lines.push("");
        lines.push(mdTable(["卷", "已拆章", "强钩子"], survey.volumes.map((v) => {
            const inside = facts.filter((f) => Number(f.n) >= v.from && Number(f.n) <= v.to);
            return [v.name, inside.length, inside.filter((f) => f.hook?.strength === "强").length];
        })));
    }
    lines.push("");
    // 10
    lines.push(section(10) + mark);
    const hasName = fsRows.some((f) => f.name);
    lines.push(fsRows.length
        ? (hasName
            ? mdTable(["伏笔", "埋设", "兑付"], fsRows.map((f) => [f.name, f.planted ?? f.plant ?? "—", f.paidOff ?? (f.status === "已兑现" ? f.payoff ?? "已兑现" : "未兑付")]))
            : mdTable(["埋设", "兑付", "状态"], fsRows.map((f) => [f.plant ?? f.planted ?? "—", f.payoff ?? f.paidOff ?? "—", f.status ?? (f.paidOff ? "已兑现" : "未兑付")])))
        : "- 未记录伏笔");
    lines.push("");
    // 11
    lines.push(section(11) + mark);
    lines.push(listOr(characters, "- 未记录人物", (c) => `- **${c.name}**（${c.role ?? "—"}）：面具=${c.mask}；真相=${c.truth}；弧光=${(c.arc ?? []).map((a) => `第${a.chapter}章 ${a.from}→${a.to}（压力：${a.pressure}）`).join("；")}`));
    lines.push("");
    // 12
    lines.push(section(12) + mark);
    lines.push(listOr(characters, "- 未记录", (c) => `- ${c.name}：${c.function ?? "—"}`));
    lines.push("");
    // 13
    lines.push(section(13));
    lines.push(stats?.length
        ? mdTable(["章", "字数", "句数", "平均句长", "对话占比"], stats.map((s) => [s.n, s.chars, s.sentences, s.avgSentence, `${Math.round((s.dialogueRatio ?? 0) * 100)}%`]))
        : "- 未统计");
    lines.push("");
    // 14
    lines.push(section(14));
    lines.push(modules.length
        ? mdTable(["标题", "层", "维度", "读者想看", "情绪走向", "戏剧单元", "版本"], modules.map((m) => [
            m.title ?? m.id ?? "（无题）",
            m.layer ?? "—",
            m.dimension ?? "—",
            String(m.readerWant ?? "").slice(0, 40) || "—",
            `${String(m.emotionArc ?? "").slice(0, 60)}${String(m.emotionArc ?? "").length > 60 ? "…" : ""}` || "—",
            `${String(m.dramaticUnit ?? "").slice(0, 60)}${String(m.dramaticUnit ?? "").length > 60 ? "…" : ""}` || "—",
            moduleTag(m),
        ]))
        : "- 未产模块");
    lines.push("");
    // 15
    lines.push(section(15));
    lines.push(listOr(modules, "- 未产模块", (m) => `- **${m.title ?? m.id ?? "（无题）"}**：${m.transfer || "（未填怎么迁）"}（失败边界：${m.failWhen || "（未填）"}）`));
    lines.push("");
    // 16
    lines.push(section(16));
    lines.push(listOr(modules, "- 未记录", (m) => `- ${m.title ?? m.id ?? "（无题）"}：${(m.mustNotCopy ?? []).join("、") || "（未记录）"}`));
    lines.push("");
    // 17
    lines.push(section(17));
    lines.push(benchmark?.trim() ? benchmark.trim() : "- 未填：至少 5 本同网站同题材样本，优先可复制样本而非唯一头部");
    lines.push("");
    // 18
    lines.push(section(18));
    lines.push(notes?.trim() ? notes.trim() : "（无）");
    lines.push("");
    // 19
    lines.push(section(19));
    if (plan) {
        lines.push(`- 档位：${planLabel(plan)}；抽样表见 analyses/${plan.sourceId}/plan.md`);
        if (plan.mode === "auto")
            lines.push("- Auto 为抽样：全书节奏/伏笔类结论只作抽样观察；要全书骨架须由作者明确要求 Full。");
        if (plan.mode === "full" && facts.length < plan.planChapters)
            lines.push(`- Full 未完成：${facts.length}/${plan.planChapters} 章。`);
    }
    if (meta?.scope?.mode !== "full") {
        lines.push(plan && plan.mode === "auto"
            ? `- 本报告为 Auto 抽样：已读 ${planDone}/${plan.planChapters} 章（计划），全书 ${total || "?"} 章；全书结论只作「抽样观察」。`
            : `- 本报告只覆盖已读的 ${facts.length} 章（全书 ${total || "?"} 章），全书结论须标「早期观察」。`);
    }
    if (coverage.needsReview) {
        lines.push("- 置信度未达 0.85：先补事实与聚合（尤其 30%/60%/85% 抽样章），再决定是否出更多模块卡。");
    }
    else if (modules.length) {
        lines.push("- 置信度达标且已有模块：可进入 library_combo_suggest（1 book + N scene），再 inspire 或 chapter_brief(lean)。");
    }
    else {
        lines.push("- 置信度达标但尚无模块：进入 library_card_stage（v2：layer+dimension+5 项+evidence）→ card_accept。");
    }
    const unpaid = fsRows.filter((f) => !(f.paidOff || f.status === "已兑现")).length;
    if (unpaid)
        lines.push(`- 未兑付伏笔 ${unpaid} 条：确认是长线还是漏记。`);
    return lines.join("\n") + "\n";
}
