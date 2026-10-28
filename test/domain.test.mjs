/** Small checks for the deterministic rules used by the writing flow. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEnding } from "../dist/lib/domain/ending-consistency.js";
import { parseChapterHeading } from "../dist/lib/domain/chapter-heading.js";
import { toCardView } from "../dist/lib/domain/card-schema.js";
import { computeCoverage, AUTO_CONFIDENCE_CAP } from "../dist/lib/domain/coverage.js";
import { auditPayoff } from "../dist/lib/payoff-audit.js";
import { formatReaderContract } from "../dist/lib/method-assets.js";
import { EMPTY_OUTLINE } from "../dist/lib/types.js";
import { lintStyle } from "../dist/lib/style-linter.js";
import { LintGate, HumanFeelGate, AcceptPolicy } from "../dist/lib/ports/index.js";
test("末拍检测理解时间别名，并对缺失落点一致告警", () => {
    assert.ok(scoreEnding("他 00:40 刷卡进楼。", "他零点四十刷卡进楼，没回头。").strongHits > 0);
    const ending = "他把侧窗的窗框钉死，回放里再也没有那扇窗。";
    const body = "她把账本合上，没再说话。灯灭之后雨停了半拍。";
    const findings = auditPayoff({ ...EMPTY_OUTLINE(), ending }, body).findings;
    assert.ok(findings.some((finding) => finding.code === "ending_missing"));
    const contract = formatReaderContract({ premise: "p", planned: "pl", threads: "t", lean: true, continuation: true, previous: { id: "c001", title: "一", ending, body } });
    assert.ok(contract.includes("前章纲末与正文可能不一致"));
});
test("中文章标题与旧卡格式仍可读取", () => {
    assert.equal(parseChapterHeading("第一章 开端")?.n, 1);
    assert.equal(parseChapterHeading("第12章 对峙")?.n, 12);
    assert.equal(parseChapterHeading("没有标题"), null);
    assert.equal(toCardView({ id: "c1", title: "旧卡", body: "动作", status: "accepted" }).legacy, true);
    assert.equal(toCardView({ id: "c2", title: "新卡", body: "x", status: "accepted", mechanisms: [{ name: "m", failWhen: "f" }], layer: "scene", dimension: "hook" }).legacy, false);
});
test("机械检测只报告信号，不声称创作质量合格", () => {
    assert.ok(lintStyle("他心中涌起一股难以言喻的感动，不禁叹了口气。").length > 0);
    assert.equal(lintStyle("他把伞收进桶里，没说话。").length, 0);
    assert.equal(LintGate.evaluateAccept({ hitCount: 2, strictLint: false }).ok, true);
    assert.equal(LintGate.evaluateAccept({ hitCount: 2, strictLint: true }).ok, false);
    assert.equal(HumanFeelGate.evaluateAccept({ body: "他觉得很难过，心中一沉。".repeat(20) }).ok, true);
    const coverage = computeCoverage({ scope: { chapters: 4, mode: "full" } }, [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [{ dimension: "hook" }, { dimension: "rhythm" }], { total: 2, ok: 2 }, { survey: true, plots: [{}], rhythms: [{}], characters: [{}], autoCap: true });
    assert.equal(coverage.capped, true);
    assert.ok(coverage.confidence <= AUTO_CONFIDENCE_CAP);
});
test("编辑候选采纳前须明确确认", () => {
    const candidate = { body: "编辑稿", lintHitCount: 0, editOf: "cand-parent" };
    const denied = AcceptPolicy.evaluate({ candidate, brief: null, payoff: null, skipBrief: true, acceptAfterEdit: true, confirmAcceptAfterEdit: false });
    assert.equal(denied.ok, false);
    assert.ok(denied.messages.some((m) => m.code === "edit_accept_confirm_required"));
    assert.equal(AcceptPolicy.evaluate({ candidate, brief: null, payoff: null, skipBrief: true, acceptAfterEdit: true, confirmAcceptAfterEdit: true }).ok, true);
});

test("证据按实际原文核对，心理词不误拒对白，重号不静默合并", async () => {
    const { quoteOk } = await import("../dist/lib/domain/evidence.js");
    assert.equal(quoteOk("她说我害怕", "她说：我害怕。"), false);
    assert.equal(quoteOk("她说：我害怕。", "她说：我害怕。"), true);
    const { chapterIndex, chapterText } = await import("../dist/lib/ports/analysis/chapters.js");
    const { validateChapterFacts } = await import("../dist/lib/ports/analysis/facts.js");
    const { buildPlan } = await import("../dist/lib/ports/analysis/plan.js");
    const text = "第一章 夜归\n她说：我害怕。随后关门。\n第一章 番外\n他打开窗。";
    const index = chapterIndex(text);
    assert.equal(chapterText(text, index, 1), null);
    assert.throws(() => buildPlan({ sourceId: "src-test", index }), e => e.code === "ambiguous_chapter_numbers");
    const result = validateChapterFacts({ n: 1, sourceStart: index[0].start, events: [{ desc: "她说：我害怕。随后关门。", quote: "她说：我害怕。随后关门。" }] }, text, index);
    assert.equal(result.errors.length, 0);
    assert.ok(result.warnings.length > 0);
});

test("源位置解析与限量扫描保留原字节坐标及精确总数",async()=>{
    const {parseManuscript}=await import('../dist/lib/domain/manuscript.js');
    const {scanStyle}=await import('../dist/lib/style-linter.js');
    const text='😀 **门外**有人。\r\n第二行。\r\n\r\n`原样`';
    const blocks=parseManuscript(text);assert.equal(blocks.length,2);
    for(const b of blocks)for(const r of b.runs)if(r.text!=='\n')assert.equal(text.slice(r.start,r.end),r.text);
    const scan=scanStyle('他不禁退后。'.repeat(20),3);assert.equal(scan.hits.length,3);assert.equal(scan.totalHits,20);
});

test('限量诊断按正文顺序保留，代码与对白不触发叙述规则或重复统计', async () => {
    const { scanStyle } = await import('../dist/lib/style-linter.js');
    const { analyzeManuscript } = await import('../dist/lib/domain/diagnostics.js');
    const scan = scanStyle('他感到害怕。\n他不禁退后。\n不是刀而是伞。', 1);
    assert.equal(scan.hits[0].start, 0);
    assert.equal(scan.totalHits, 3);
    const skipped = analyzeManuscript('# 他不禁退后\n\n> 他不禁退后\n\n`他不禁退后。他不禁退后。`\n\n“他不禁退后。他不禁退后。”\n\n```\n他不禁退后\n```');
    assert.equal(skipped.totalHits, 0);
    assert.equal(skipped.summary.sentenceCount, 0);
    const text = '外面有人。外面有人。\n\n他不禁退后。'.repeat(80);
    const report = analyzeManuscript(text);
    assert.equal(report.scanComplete, true);
    assert.equal(report.limited, true);
    assert.equal(report.issues.length, 120);
    for (let i = 1; i < report.issues.length; i++) assert.ok(report.issues[i].start >= report.issues[i - 1].start);
    for (const issue of report.issues) assert.equal(text.slice(issue.start, issue.end), issue.match);
    assert.ok(report.issues.some(issue => issue.origin === 'statistic'));
});

test('对白范围按配对符号识别，未闭合引号不会吞掉叙述', async () => {
    const { dialogueRanges, lintStyle } = await import('../dist/lib/style-linter.js');
    assert.deepEqual(dialogueRanges('“甲「乙」丙”外。'),[[0,7]]);
    assert.equal(lintStyle('“'.repeat(30000)+'他不禁退后。').length,1);
    assert.equal(lintStyle('“他不禁退后。”').length,0);
    assert.equal(lintStyle('“未闭合，他不禁退后。').length,1);
    const { parseManuscript } = await import('../dist/lib/domain/manuscript.js');
    assert.equal(parseManuscript('*a*'.repeat(100000))[0].runs.length,100000);
});

test("客户端拒收旧项目响应，摘要版本与手动刷新使旧正文失效", async () => {
    const { reducer, initialState, bodyKey } = await import("../src/client/state.js");
    let state = { ...initialState(), projectId: "a", work: "同名作品", mode: "novel", chapterId: "c001", snapshot: { chapters: [{ id: "c001", updatedAt: "v1" }], candidates: [] } };
    const key = bodyKey(state, "chapter");
    state = reducer(state, { type: "body", slot: "chapter", value: { key, status: "ready", body: "项目甲正文", meta: { id: "c001", revision: "r1" } } });
    state = reducer(state, { type: "openDialog", dialog: { kind: "review" } });
    const confirmation = state.dialog;
    assert.equal(confirmation.meta.revision, "r1");
    state = reducer(state, { type: "selectProject", id: "b" });
    assert.equal(state.dialog, null);
    assert.equal(state.chapter.body, "");
    const selected = state;
    state = reducer(state, { type: "snapshot", selection: 0, data: { snapshot: { workKey: "旧作品", chapters: [] } }, signature: "late" });
    assert.equal(state, selected);
    state = reducer(state, { type: "body", slot: "chapter", value: { key, status: "ready", body: "迟到旧正文" } });
    assert.equal(state, selected);
    state = reducer(state, { type: "snapshot", selection: state.selection, data: { projectId: "b", snapshot: { workKey: "同名作品", chapters: [{ id: "c001", updatedAt: "v2" }], candidates: [] } }, signature: "new" });
    const nextKey = bodyKey(state, "chapter");
    assert.notEqual(nextKey, key);
    state = reducer(state, { type: "body", slot: "chapter", value: { key: nextKey, status: "ready", body: "项目乙正文", meta: { id: "c001", revision: "r2" } } });
    state = reducer(state, { type: "reloadBodies" });
    assert.equal(state.chapter.status, "idle");
    assert.notEqual(bodyKey(state, "chapter"), nextKey);
    assert.equal(confirmation.meta.revision, "r1");
});


test('段落撤销重做保留完整修改，来源切换与正文变化阻止误绑', async () => {
    const { changeParagraph, moveHistory, revisionPayload, editMatches, diagnosticScope } = await import('../src/client/edit-state.js');
    let state = {selection:0,projectId:'p',work:'w',chapterId:'c001',diagnosticKind:'chapter',chapter:{status:'ready',body:'门外有人。',meta:{revision:'rev',bodyHash:'hash'}}};
    let edit = {scope:diagnosticScope(state),base:'p',work:'w',original:state.chapter.body,report:{source:{kind:'chapter',targetRevision:'rev',bodyHash:'hash'},blocks:[{start:0,end:5}]},edits:{},history:[],future:[],dirty:false};
    edit = changeParagraph(edit, 0, '门外无人。');
    const id = edit.requestId;
    assert.equal(edit.dirty, true);
    edit = moveHistory(edit);
    assert.equal(edit.dirty, false);
    edit = moveHistory(edit, true);
    assert.equal(edit.dirty, true);
    assert.notEqual(edit.requestId, id);
    assert.deepEqual(revisionPayload(edit).edits, [{start:0,end:5,before:'门外有人。',after:'门外无人。'}]);
    state = {...state,edit};
    assert.equal(editMatches(state,'chapter'),true);
    assert.equal(editMatches({...state,work:'other'},'chapter'),false);
    assert.equal(editMatches({...state,chapter:{...state.chapter,meta:{revision:'rev',bodyHash:'changed'}}},'chapter'),false);
    for(let i=0;i<80;i++) edit=changeParagraph(edit,0,'稿'.repeat(40000)+i);
    assert.ok(edit.history.length > 0 && edit.history.length < 50);
    assert.ok(JSON.stringify(edit.history).length * 2 < 2 * 1024 * 1024);
});


test("插件配置按导出的 Standard Schema 校验并补默认值", async () => {
    const { Config } = await import("../dist/index.js");
    for (const schema of [Config]) {
        const std = schema["~standard"];
        const ok = std.validate({ storageRoot: "/data", multiDraft: { enabled: true } });
        assert.equal(ok.issues, undefined);
        assert.equal(ok.value.rootDir, ".zhizhang");
        assert.equal(ok.value.storageRoot, "/data");
        assert.equal(ok.value.multiDraft.enabled, true);
        assert.equal(std.validate({}).value.worksRoot, undefined);
        assert.equal(std.validate({ worksRoot: "  ", libraryRoot: "" }).value.worksRoot, undefined);
        assert.equal(std.validate({ worksRoot: "  ", libraryRoot: "" }).value.libraryRoot, undefined);
        assert.ok(std.validate({ multiDraft: { enabled: "yes" } }).issues.length > 0);
        assert.ok(std.validate({ allowLanPanel: "yes" }).issues.length > 0);
    }
});

async function loadedClient(extra = {}) {
    const { readFile } = await import("node:fs/promises"), { runInNewContext } = await import("node:vm");
    let descriptor;
    const react = { createElement: (type, props) => ({ type, props }), Component: class {}, Fragment: "f", memo: c => c };
    runInNewContext(await readFile("dist/client.js", "utf8"), { window: { __ModuleLoader__: { load: value => { descriptor = value; } } }, URL, AbortController, setTimeout, clearTimeout, ...extra });
    return descriptor.factory(id => { if (id === "react") return react; throw new Error("unexpected module " + id); });
}
