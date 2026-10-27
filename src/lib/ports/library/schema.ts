/**
 * 卡 schema / 规范化 / 准入 / 格式化 — 从 library.js 拆出的纯逻辑。
 * 不读写磁盘；只依赖 errors.js。
 */
import { ZhizhangError } from "../../errors.js";

/** Shatter-logic cues (A–G) — book-agnostic anti-stiffness language on craft cards. */
export const SHATTER_CRAFT_CUE_RE = /打碎|反僵硬|僵硬|呼吸不齐|半截|侧漏|错半拍|先错|余震|拧着|不收齐|信息从.{0,16}漏|打断后|第一反应.{0,12}(错|一半)|功能拍后|应落纸|本场不完美|本场打碎|别收成合格|别写成说明|长短起伏|意义不必/;
/** Soft-warn: allowedEdges still written as permission ("可以/允许…"). */
export const PERMISSION_EDGE_RE = /^(可以|允许)/;
export const DEFAULT_FAIL_AS_TEMPLATE = "写成句句收齐、反应全对、说明段讲义、意义被作者收完的僵硬范文即失败";
/** One-line anti-stiffness cue appended to lean brief when craft promises shatter. */
export const ANTI_STIFFNESS_BRIEF_LINE = "本场反僵硬：按卡上的打碎逻辑写——呼吸可不一、念头可留半截、信息可侧漏、反应可先错；功能拍后可留余震；别把意义收成合格范文。";
export function hasShatterCraftCue(...parts: any[]) {
    const blob = parts.filter(Boolean).join("\n");
    return blob.length > 0 && SHATTER_CRAFT_CUE_RE.test(blob);
}

export function normalizeMechanism(raw: any, i: number) {
    if (!raw || typeof raw !== "object") {
        throw new ZhizhangError("bad_mechanism", `mechanisms[${i}] 必须是对象`);
    }
    const m = raw;
    const name = String(m.name ?? "").trim();
    const experience = String(m.experience ?? "").trim();
    const rebuild = String(m.rebuild ?? "").trim();
    const discard = String(m.discard ?? "").trim();
    const failWhen = String(m.failWhen ?? "").trim();
    if (!name)
        throw new ZhizhangError("bad_mechanism", `mechanisms[${i}].name 不能为空`);
    if (!failWhen)
        throw new ZhizhangError("bad_mechanism", `mechanisms[${i}].failWhen 不能为空`);
    return {
        name,
        experience: experience || "（未填）",
        rebuild: rebuild || "（未填）",
        discard: discard || "（未填）",
        failWhen,
    };
}
/**
 * Normalize optional humanFeel. Missing block → soft warn, card still stages.
 * Accepts 0.6 writerCraft/characterState shape AND legacy voice/realness shape.
 * Never hard-reject for migration.
 */
export function normalizeHumanFeel(raw: any) {
    const warnings: string[] = [];
    if (raw == null) {
        warnings.push("未填 humanFeel（活人证据）：兼容可过；新拆书请补 writerCraft / characterState / allowedEdges / failAsTemplate");
        return { warnings };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
        warnings.push("humanFeel 须为对象，已忽略");
        return { warnings };
    }
    const h = raw;
    // Legacy fields (0.5.x)
    const legacyVoice = String(h.voice ?? "").trim();
    const legacyVoiceRange = String(h.voiceRange ?? h.voice_range ?? "").trim();
    const legacyRealness = String(h.realness ?? "").trim();
    let writerCraft = String(h.writerCraft ?? h.writer_craft ?? "").trim();
    let craftRange = String(h.craftRange ?? h.craft_range ?? "").trim();
    let characterState = String(h.characterState ?? h.character_state ?? "").trim();
    let stateOnPage = String(h.stateOnPage ?? h.state_on_page ?? "").trim();
    const allowedEdges = String(h.allowedEdges ?? h.allowed_edges ?? "").trim();
    const failAsTemplate = String(h.failAsTemplate ?? h.fail_as_template ?? "").trim();
    // Migrate legacy → new
    if (!writerCraft && legacyRealness) {
        writerCraft = legacyRealness;
        warnings.push("已将旧 humanFeel.realness 迁为 writerCraft（写法）");
    }
    if (!craftRange && legacyVoiceRange) {
        craftRange = legacyVoiceRange;
    }
    if (!stateOnPage && legacyVoice) {
        stateOnPage = legacyVoice;
        warnings.push("已将旧 humanFeel.voice 迁为 stateOnPage（落纸手法证据）");
    }
    if (legacyVoice && !h.writerCraft && !h.characterState) {
        warnings.push("检测到旧口径 voice/realness：请改填 writerCraft（作家写法）+ characterState（角色状态）");
    }
    if (!writerCraft) {
        warnings.push("humanFeel.writerCraft 为空：未写作家写法（场面取舍/信息怎么漏/节奏或小物等）");
    }
    if (!characterState) {
        warnings.push("humanFeel.characterState 为空：未写这一刻角色状态（非声纹）");
    }
    if (!stateOnPage) {
        warnings.push("humanFeel.stateOnPage 为空：未写状态落到纸上的手法");
    }
    if (!allowedEdges) {
        warnings.push("humanFeel.allowedEdges 为空：未写本场应落纸的不完美（打碎正向）");
    }
    if (!failAsTemplate) {
        warnings.push("humanFeel.failAsTemplate 为空：建议点名僵硬版（句句收齐/反应全对/讲义/意义收完）");
    }
    if (allowedEdges && PERMISSION_EDGE_RE.test(allowedEdges.trim())) {
        warnings.push("humanFeel.allowedEdges 像许可句（可以/允许…）：请改成「本场应落纸：…」打碎正向句");
    }
    return {
        humanFeel: {
            writerCraft: writerCraft || "（未填）",
            craftRange: craftRange || "（见 readingRange）",
            characterState: characterState || "（未填）",
            stateOnPage: stateOnPage || "（未填）",
            allowedEdges: allowedEdges || "（未填）",
            failAsTemplate: failAsTemplate || DEFAULT_FAIL_AS_TEMPLATE,
        },
        warnings,
    };
}
/** Coerce on-disk / in-memory humanFeel that may still be legacy voice shape. */
export function coerceHumanFeel(raw: any) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const h = raw;
    if (typeof h.writerCraft === "string" || typeof h.characterState === "string") {
        return {
            writerCraft: String(h.writerCraft ?? "").trim() || "（未填）",
            craftRange: String(h.craftRange ?? h.voiceRange ?? "").trim() || "（见 readingRange）",
            characterState: String(h.characterState ?? "").trim() || "（未填）",
            stateOnPage: String(h.stateOnPage ?? h.voice ?? "").trim() || "（未填）",
            allowedEdges: String(h.allowedEdges ?? "").trim() || "（未填）",
            failAsTemplate: String(h.failAsTemplate ?? "").trim() ||
                DEFAULT_FAIL_AS_TEMPLATE,
        };
    }
    // pure legacy
    if (h.voice != null || h.realness != null || h.voiceRange != null) {
        return {
            writerCraft: String(h.realness ?? "").trim() || "（未填）",
            craftRange: String(h.voiceRange ?? "").trim() || "（见 readingRange）",
            characterState: "（旧卡未分状态）",
            stateOnPage: String(h.voice ?? "").trim() || "（未填）",
            allowedEdges: String(h.allowedEdges ?? "").trim() || "（未填）",
            failAsTemplate: String(h.failAsTemplate ?? "").trim() ||
                DEFAULT_FAIL_AS_TEMPLATE,
        };
    }
    return undefined;
}
export function craftCueFromHumanFeel(hf: any) {
    const c = coerceHumanFeel(hf);
    if (!c)
        return "";
    return [c.writerCraft, c.characterState, c.stateOnPage, c.allowedEdges, c.failAsTemplate]
        .filter(Boolean)
        .join("\n");
}
/** Format humanFeel for forge / brief / card_get. Missing → thin craft/state note. */
export function formatHumanFeelBlock(hf: any) {
    const c = coerceHumanFeel(hf);
    if (!c) {
        return [
            "⚠️ **写法/状态偏薄**：本卡无 humanFeel（旧卡或未填）。",
            "请补作家写法 + 场面状态，或换一张有人味的卡。",
            "- （缺 writerCraft / characterState / allowedEdges / failAsTemplate）",
        ].join("\n");
    }
    return [
        `- 作家写法（writerCraft）：${c.writerCraft}`,
        `- 出处范围（craftRange）：${c.craftRange}`,
        `- 角色状态（characterState）：${c.characterState}`,
        `- 落纸手法（stateOnPage）：${c.stateOnPage}`,
        `- 本场不完美·应落纸（allowedEdges）：${c.allowedEdges}`,
        `- 僵硬范文失败（failAsTemplate）：${c.failAsTemplate}`,
    ].join("\n");
}
/**
 * Normalize optional bookCraft. Missing → soft warn; never hard-reject.
 */
export function normalizeBookCraft(raw: any) {
    const warnings: string[] = [];
    if (raw == null) {
        warnings.push("未填 bookCraft（继续证据）：兼容可过；新拆书请补 continueWhy / failAsShortStory");
        return { warnings };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
        warnings.push("bookCraft 须为对象，已忽略");
        return { warnings };
    }
    const b = raw;
    const continueWhy = String(b.continueWhy ?? b.continue_why ?? "").trim();
    const adjacentChange = String(b.adjacentChange ?? b.adjacent_change ?? "").trim();
    const failAsShortStory = String(b.failAsShortStory ?? b.fail_as_short_story ?? "").trim();
    if (!continueWhy) {
        warnings.push("bookCraft.continueWhy 为空：未写收束后为何还想翻");
    }
    if (!failAsShortStory) {
        warnings.push("bookCraft.failAsShortStory 为空：建议写「写成独立短篇闭环即失败」");
    }
    const bookCraft: { continueWhy: string; adjacentChange?: string; failAsShortStory?: string } = {
        continueWhy: continueWhy || "（未填）",
    };
    if (adjacentChange)
        bookCraft.adjacentChange = adjacentChange;
    else
        warnings.push("bookCraft.adjacentChange 未填：可选，建议写相邻单元变了什么");
    bookCraft.failAsShortStory =
        failAsShortStory || "写成独立短篇闭环、章末无书债、同骨架再演示设定即失败";
    return { bookCraft, warnings };
}
/** Format bookCraft for forge / brief / card_get. */
export function formatBookCraftBlock(bc: any) {
    if (!bc) {
        return [
            "⚠️ **书感偏薄**：本卡无 bookCraft（旧卡或未填）。",
            "请补「收束后为何还想翻」与相邻压力变化。",
            "- （缺 continueWhy / adjacentChange / failAsShortStory）",
        ].join("\n");
    }
    const lines = [
        `- 继续为何（continueWhy）：${bc.continueWhy}`,
    ];
    if (bc.adjacentChange) {
        lines.push(`- 相邻变化（adjacentChange）：${bc.adjacentChange}`);
    }
    else {
        lines.push("- 相邻变化（adjacentChange）：（未填）");
    }
    lines.push(`- 短篇闭环失败（failAsShortStory）：${bc.failAsShortStory ?? "（未填）"}`);
    return lines.join("\n");
}
/**
 * Normalize optional handoff four-tuple. Missing → soft warn only.
 */
export function normalizeHandoff(raw: any) {
    const warnings: string[] = [];
    if (raw == null) {
        warnings.push("未填 handoff（purpose/experience/rebuild/discard）：可选；有助于交接");
        return { warnings };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
        warnings.push("handoff 须为对象，已忽略");
        return { warnings };
    }
    const h = raw;
    const purpose = String(h.purpose ?? "").trim();
    const experience = String(h.experience ?? "").trim();
    const rebuild = String(h.rebuild ?? "").trim();
    const discard = String(h.discard ?? "").trim();
    if (!purpose || !experience || !rebuild || !discard) {
        warnings.push("handoff 四项有空：已填默认占位");
    }
    return {
        handoff: {
            purpose: purpose || "（未填）",
            experience: experience || "（未填）",
            rebuild: rebuild || "（未填）",
            discard: discard || "（未填；须丢弃原作剧情与人名）",
        },
        warnings,
    };
}
export function formatHandoffBlock(h: any) {
    if (!h)
        return "（无 handoff）";
    return [
        `- purpose：${h.purpose}`,
        `- experience：${h.experience}`,
        `- rebuild：${h.rebuild}`,
        `- discard：${h.discard}`,
    ].join("\n");
}
const KIND_SET = new Set(["craft", "scene", "book", "voice"]); // voice=legacy alias → craft
export function normalizeKind(raw: any) {
    const warnings: string[] = [];
    if (raw == null || raw === "") {
        return { warnings };
    }
    let k = String(raw).trim().toLowerCase();
    if (k === "voice") {
        warnings.push("kind=voice 已迁为 craft（写法卡；非角色声纹）");
        k = "craft";
    }
    if (k !== "craft" && k !== "scene" && k !== "book") {
        warnings.push(`kind 无效「${raw}」（须 craft|scene|book；旧 voice→craft），已忽略`);
        return { warnings };
    }
    return { kind: k, warnings };
}
/**
 * Normalize / infer axis. Missing → soft warn + default craft (compat).
 * kind=book never becomes mind.
 */
export function normalizeAxis(raw: any, hints: any = {}) {
    const warnings: string[] = [];
    const rawStr = raw == null || raw === "" ? "" : String(raw).trim().toLowerCase();
    if (rawStr === "craft" || rawStr === "mind") {
        return { axis: rawStr, warnings };
    }
    if (rawStr) {
        warnings.push(`axis 无效「${raw}」（须 craft|mind），已按证据推断`);
    }
    const tags = (hints.tags ?? []).map((t: any) => String(t).toLowerCase());
    const tagMind = tags.some((t: any) => t === "mind" || t.includes("思维") || t.includes("创作思维") || t === "planning");
    if (hints.hasMind || tagMind) {
        if (!rawStr)
            warnings.push("未声明 axis：按 mind 证据推断为 mind");
        return { axis: "mind", warnings };
    }
    if (hints.hasHumanFeel || hints.hasBookCraft) {
        if (!rawStr)
            warnings.push("未声明 axis：按 humanFeel/bookCraft 推断为 craft");
        return { axis: "craft", warnings };
    }
    // kind is secondary — never promote kind=book to mind
    if (!rawStr)
        warnings.push("未声明 axis：已默认 craft（兼容旧卡）");
    return { axis: "craft", warnings };
}
/** Coerce on-disk card axis for reads (never throw). */
export function coerceAxis(card: any) {
    const raw = card.axis;
    if (raw === "craft" || raw === "mind")
        return raw;
    const mind = card.mind;
    if (mind && typeof mind === "object")
        return "mind";
    const hf = card.humanFeel;
    if (hf && typeof hf === "object")
        return "craft";
    const tags = Array.isArray(card.tags)
        ? card.tags
        : [];
    if (tags.some((t: any) => /mind|思维|planning/i.test(String(t))))
        return "mind";
    return "craft";
}
/**
 * Normalize optional mind block. Missing → soft warn for mind-axis callers.
 */
export function normalizeMind(raw: any) {
    const warnings: string[] = [];
    if (raw == null) {
        warnings.push("未填 mind（创作思维）：mind 轴请补 sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract / failAsEncyclopedia");
        return { warnings };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
        warnings.push("mind 须为对象，已忽略");
        return { warnings };
    }
    const m = raw;
    const sellIntoCost = String(m.sellIntoCost ?? m.sell_into_cost ?? "").trim();
    const infoStaging = String(m.infoStaging ?? m.info_staging ?? "").trim();
    const pressureMachine = String(m.pressureMachine ?? m.pressure_machine ?? "").trim();
    const debtAndSwap = String(m.debtAndSwap ?? m.debt_and_swap ?? "").trim();
    const readerContract = String(m.readerContract ?? m.reader_contract ?? "").trim();
    const failAsEncyclopedia = String(m.failAsEncyclopedia ?? m.fail_as_encyclopedia ?? "").trim();
    if (!sellIntoCost)
        warnings.push("mind.sellIntoCost 为空：未写卖点如何进能力/代价");
    if (!infoStaging)
        warnings.push("mind.infoStaging 为空：未写信息分期");
    if (!pressureMachine)
        warnings.push("mind.pressureMachine 为空：未写关系压力机");
    if (!debtAndSwap)
        warnings.push("mind.debtAndSwap 为空：未写长线债与换压");
    if (!readerContract)
        warnings.push("mind.readerContract 为空：未写读者合同如何立");
    if (!failAsEncyclopedia) {
        warnings.push("mind.failAsEncyclopedia 为空：建议写「写成百科/设定表/梗概即失败」");
    }
    return {
        mind: {
            sellIntoCost: sellIntoCost || "（未填）",
            infoStaging: infoStaging || "（未填）",
            pressureMachine: pressureMachine || "（未填）",
            debtAndSwap: debtAndSwap || "（未填）",
            readerContract: readerContract || "（未填）",
            failAsEncyclopedia: failAsEncyclopedia || "写成世界观百科、剧情梗概、设定表堆砌即失败",
        },
        warnings,
    };
}
export function formatMindBlock(mind: any) {
    if (!mind) {
        return [
            "⚠️ **创作思维偏薄**：本卡无 mind 块。",
            "请补卖点进代价 / 信息分期 / 压力机 / 长线债 / 读者合同。",
            "- （缺 sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract）",
        ].join("\n");
    }
    return [
        `- 卖点→代价（sellIntoCost）：${mind.sellIntoCost}`,
        `- 信息分期（infoStaging）：${mind.infoStaging}`,
        `- 压力机（pressureMachine）：${mind.pressureMachine}`,
        `- 长线债/换压（debtAndSwap）：${mind.debtAndSwap}`,
        `- 读者合同（readerContract）：${mind.readerContract}`,
        `- 百科失败（failAsEncyclopedia）：${mind.failAsEncyclopedia}`,
    ].join("\n");
}
/** Soft warn if characterState looks like a personality wall. */
export function warnCharacterStateWall(state: any) {
    const s = String(state ?? "").trim();
    if (!s || s === "（未填）")
        return [];
    const warnings: string[] = [];
    if (/性格[：:]/.test(s) ||
        /人设[：:]/.test(s) ||
        /(MBTI|INFP|INTJ|ENFP)/i.test(s) ||
        /爱好[：:].*讨厌[：:]/.test(s) ||
        /(善良|勇敢|聪明|傲娇).{0,8}(善良|勇敢|聪明|傲娇)/.test(s)) {
        warnings.push("characterState 疑似人设墙：应写这一刻场面状态（慌/赖皮/算账），非固定性格清单");
    }
    return warnings;
}
/**
 * Strip negation / disclaimer contexts that mention 声纹 without teaching voice.
 * Fixes false positive on「非声纹」「≠角色声纹」etc. (0.10.0).
 */
export function neutralizeVoiceNegations(text: string) {
    return String(text ?? "").replace(/非声纹|禁止声纹|勿当[^。\n]{0,16}声纹|不是[^。\n]{0,12}声纹|≠[^。\n]{0,10}声纹|（非声纹）|\(非声纹\)|非角色声纹|勿学嘴|勿[^。\n]{0,8}声纹背诵|拒收[^。\n]{0,8}声纹|禁止[^。\n]{0,8}声纹|勿灌角色声纹|不灌角色声纹/g, " ");
}
/** Collect short snippets around regex hits for reject receipts. */
export function collectAdmitHits(hay: any, re: any, limit: number = 3) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const g = new RegExp(re.source, flags);
    const hits = [];
    let m;
    while ((m = g.exec(hay)) !== null) {
        const start = Math.max(0, m.index - 10);
        const end = Math.min(hay.length, m.index + m[0].length + 10);
        const snip = hay.slice(start, end).replace(/\s+/g, " ").trim();
        if (snip)
            hits.push(snip);
        if (hits.length >= limit)
            break;
    }
    return hits;
}
function formatAdmitReject(kind: any, hits: any, fix: any) {
    const shown = hits.length ? hits.map((h: any) => `「${h}」`).join(" ") : "（未截到片段）";
    return `拒收：${kind}。命中：${shown}。改法：${fix}`;
}
/**
 * Admission: hard-reject obvious encyclopedia / voice-teaching / plot-summary cards.
 * Soft path otherwise. Voice checks ignore negation disclaimers (非声纹…).
 */
/** 读没读的痕迹：证据段、章号、设计决策/检验方法、写法段。只是形状检查，真读仍需人判。 */
export function readingArtifactWarnings(body: string, axis: any) {
    const w = [];
    const text = String(body ?? "");
    if (!/^##\s*证据/m.test(text))
        w.push("缺「## 证据」段：没有原文引文，等于没读");
    if (!/第\s*[0-9一二三四五六七八九十百千零两]+\s*章/.test(text))
        w.push("证据里没有章号：只有概括/简介，无法核对是否真读");
    if (axis === "mind") {
        if (!/设计决策/.test(text))
            w.push("mind 卡缺「设计决策」段：容易把设定复述当创作思维");
        if (!/检验方法/.test(text))
            w.push("mind 卡缺「检验方法」：写完没法验，等于没拆");
    }
    else if (!/##\s*写法|写法：/.test(text)) {
        w.push("craft 卡缺「写法」段：读者拿不到这一场怎么写");
    }
    return w;
}

export function admitCardContent(input: any) {
    const warnings: string[] = [];
    const title = input.title.trim();
    const body = input.body.trim();
    const raw = `${title}\n${body}`;
    const hay = raw.toLowerCase();
    const mechNames = input.mechanisms.map((m: any) => m.name).join(" ");
    // Hard reject patterns — voice: scrub negations first (避免「非声纹」假阳)
    const voiceHay = neutralizeVoiceNegations(raw);
    const voiceRe = /声纹|台词范本|角色口气正例|模仿.{0,8}对白|背诵.{0,8}台词|专属声音/;
    const voiceEnRe = /voice\s*sample|dialogue\s*template/i;
    const voiceTeach = voiceRe.test(voiceHay) || voiceEnRe.test(neutralizeVoiceNegations(hay));
    const encyclopediaRe = /世界观词条|设定百科|人物小传合集|名词解释表|原作专名对照/;
    const encyclopedia = encyclopediaRe.test(raw) ||
        (/^【?词条/.test(title) && /设定|世界观/.test(body));
    const plotRe = /全章复述|逐章剧情摘要|抄原作情节链/;
    const plotSummary = /^(剧情|情节)(梗概|大纲|复述)$/.test(title) ||
        (plotRe.test(raw) && !/不抄|禁止抄|丢弃原作/.test(body));
    if (voiceTeach) {
        const hits = [
            ...collectAdmitHits(voiceHay, voiceRe),
            ...collectAdmitHits(neutralizeVoiceNegations(hay), voiceEnRe),
        ].slice(0, 3);
        return {
            hardReject: formatAdmitReject("角色声纹/台词范本不是创作技能（会污染创作 AI 气口）", hits, "删教嘴内容；若只是声明「非声纹/≠声纹」可保留，把场面状态写进 characterState。"),
            warnings,
        };
    }
    if (encyclopedia) {
        const hits = collectAdmitHits(raw, encyclopediaRe);
        if (/^【?词条/.test(title))
            hits.unshift(title.slice(0, 24));
        return {
            hardReject: formatAdmitReject("世界观百科/词条不是可迁移创作技能", hits.slice(0, 3), "改写成可迁移的写法或创作思维（mechanism/mind）。"),
            warnings,
        };
    }
    if (plotSummary) {
        const hits = /^(剧情|情节)/.test(title)
            ? [title]
            : collectAdmitHits(raw, plotRe);
        return {
            hardReject: formatAdmitReject("剧情梗概/情节复述不是技法或创作思维", hits.slice(0, 3), "丢掉事件链复述；抽出可迁移的压力换/写法证据。"),
            warnings,
        };
    }
    // Soft: axis mismatch hints
    if (input.axis === "craft") {
        if (/卷纲设计|世界观如何分期|能力代价飞轮/.test(`${title}${body}`) && !/写法|场面|落纸|节奏/.test(body)) {
            warnings.push("内容更像创作思维：建议改 axis=mind，或补场面写法证据");
        }
    }
    else {
        if (/半截话怎么写|递烟小物|叙述口吻/.test(`${title}${body}`) && !/能力|代价|分期|压力|读者合同/.test(body)) {
            warnings.push("内容更像写作技法：建议改 axis=craft，或补设定/纲向思维字段");
        }
    }
    if (/原作专名|卡塞尔学院|言灵体系词条/.test(mechNames)) {
        warnings.push("mechanisms.name 疑似原作名词词条：应迁过程/结构，不迁专名");
    }
    return { warnings };
}
/**
 * Full card inject block. Branches by axis.
 * craft: humanFeel + bookCraft + mechanisms
 * mind: mind + mechanisms（规划向）
 */
export function formatModuleBlockV2(card: any) {
    const ev = (card.evidence ?? [])
        .map((e: any) => `${String(e.chapter ?? "").trim()}「${String(e.quote ?? "").slice(0, 40)}…」`)
        .join("；");
    return [
        `- 层/维度：${card.layer ?? "—"}/${card.dimension ?? "—"}`,
        `- 读者想看：${card.readerWant ?? "（未填）"}`,
        `- 情绪走向：${card.emotionArc ?? "（未填）"}`,
        `- 戏剧单元：${card.dramaticUnit ?? "（未填）"}`,
        `- 可替换：${(card.replaceables ?? []).join("、") || "（未填）"}`,
        `- 不可照搬：${(card.mustNotCopy ?? []).join("、") || "（未填）"}`,
        `- 迁移：${card.transfer ?? "（未填）"}`,
        `- 失败边界：${card.failWhen ?? "（未填）"}`,
        `- 证据：${ev || "（未填）"}`,
        ...(Array.isArray(card.readingEvidence?.chapters)
            ? [`- 引用章阅读程度（提交时申报，非机械证明）：${card.readingEvidence.chapters.map((c: any) => `第${c.chapter}章 ${c.readingLevel}`).join("；") || "未声明"}`]
            : ["- 引用章阅读程度：未声明（旧卡无申报快照）"]),
        ...(Array.isArray(card.steps) && card.steps.length ? [`- 操作步骤：${card.steps.map((x: any, i: number) => `${i + 1}) ${x}`).join(" ")}`] : []),
        ...(Array.isArray(card.bannedDiction) && card.bannedDiction.length ? [`- 禁用词句：${card.bannedDiction.join("、")}`] : []),
    ].join("\n");
}
export function formatTechniqueCardBlock(card: any) {
    const axis = coerceAxis(card);
    const mech = card.mechanisms
        .map((m: any, i: number) => `${i + 1}. **${m.name}**\n   - 体验：${m.experience}\n   - 重建：${m.rebuild}\n   - 可弃：${m.discard}\n   - 失败边界：${m.failWhen}`)
        .join("\n");
    const kindLine = card.kind
        ? `- kind（次标签）：${card.kind}`
        : "- kind：（未标；≠ axis）";
    const axisLine = `- axis：**${axis}**（${axis === "craft" ? "写作技法→正文" : "创作思维→设定/纲"}）`;
    if (axis === "mind") {
        const isV2 = Boolean(card.layer || card.schemaVersion === 2);
        const thinMind = !card.mind && !isV2;
        return [
            `### 创作思维卡 · ${card.title}（${card.id}）`,
            `- sourceId：${card.sourceId}`,
            axisLine,
            kindLine,
            `- tags：${card.tags.join("、") || "（无）"}`,
            `- readingRange：${card.readingRange}`,
            thinMind ? "- ⚠️ 创作思维偏薄：缺 mind" : isV2 ? "- ✓ v2 模块（层/维度 + 5 项）" : "- ✓ 含 mind（创作思维）",
            "",
            isV2 ? "#### 模块（v2）——层/维度 + 机制 5 项" : "#### 创作思维（mind）——设定 / 章纲 / 卷纲",
            isV2 ? formatModuleBlockV2(card) : formatMindBlock(card.mind),
            "",
            ...(card.handoff
                ? ["#### handoff（交接四项）", formatHandoffBlock(card.handoff), ""]
                : []),
            "#### 可迁机制（结构/设计过程；不抄剧情）",
            mech || "（无机制）",
            "",
            "#### 分析正文",
            card.body,
        ].join("\n");
    }
    const isV2 = Boolean(card.layer || card.schemaVersion === 2);
    const thinFeel = !card.humanFeel && !isV2;
    const thinBook = !card.bookCraft && !isV2;
    const flags = [];
    flags.push(isV2 ? "✓ v2 模块（层/维度 + 5 项）" : thinFeel ? "⚠️ 写法/状态偏薄：缺 humanFeel" : "✓ 含写法+状态");
    flags.push(isV2 ? `层/维度：${card.layer}/${card.dimension}` : thinBook ? "⚠️ 续写面偏薄：缺 bookCraft" : "✓ 含继续证据");
    return [
        `### 技法卡 · ${card.title}（${card.id}）`,
        `- sourceId：${card.sourceId}`,
        axisLine,
        kindLine,
        `- tags：${card.tags.join("、") || "（无）"}`,
        `- readingRange：${card.readingRange}`,
        `- ${flags.join(" · ")}`,
        "",
        isV2 ? "#### 模块（v2）——层/维度 + 机制 5 项" : "#### 活人证据（humanFeel）——作家写法 + 场面状态",
        isV2 ? formatModuleBlockV2(card) : formatHumanFeelBlock(card.humanFeel),
        "",
        ...(isV2
            ? []
            : ["#### 续写面（bookCraft）——章级继续为何（≠ 完整创作思维）", formatBookCraftBlock(card.bookCraft), ""]),
        ...(card.handoff
            ? ["#### handoff（交接四项）", formatHandoffBlock(card.handoff), ""]
            : []),
        "#### 机制（次之；只迁技巧，不抄剧情）",
        mech || "（无机制）",
        "",
        "#### 分析正文",
        card.body,
    ].join("\n");
}
/**
 * Lean block for chapter_brief：**仅 craft**。
 * mind 卡返回一行提示，不整段灌句式/规划正文。
 */
export function formatTechniqueCardBlockLean(card: any) {
    const axis = coerceAxis(card);
    if (axis === "mind") {
        return [
            `### 创作思维卡 · ${card.title}（${card.id}）· axis=mind`,
            "- （规划侧资产：不注入 lean 正文 brief 当句式范本；设定/纲请走 inspire_forge）",
        ].join("\n");
    }
    if (card.layer || card.schemaVersion === 2) {
        return [
            `### 技法模块 · ${card.title}（${card.id}）· axis=craft`,
            formatModuleBlockV2(card),
        ].join("\n");
    }
    const hf = coerceHumanFeel(card.humanFeel);
    const bc = card.bookCraft;
    const craft = hf?.writerCraft?.trim() || "（无写法 — 偏薄）";
    const state = hf?.characterState?.trim() || "（无状态 — 偏薄）";
    const onPage = hf?.stateOnPage?.trim();
    const edges = hf?.allowedEdges?.trim() || "（未填本场不完美）";
    const failVoice = hf?.failAsTemplate?.trim() || DEFAULT_FAIL_AS_TEMPLATE;
    const continueWhy = bc?.continueWhy?.trim() || "（无 continueWhy）";
    const adjacent = bc?.adjacentChange?.trim();
    const lines = [
        `### 技法卡 · ${card.title}（${card.id}）· axis=craft`,
        `- 层/维度：${card.layer ?? "—"}/${card.dimension ?? "—"}`,
        `- 写法：${craft}`,
        `- 状态：${state}`,
    ];
    if (onPage)
        lines.push(`- 落纸手法：${onPage}`);
    lines.push(`- 本场不完美（应落纸）：${edges}`, `- 僵硬即失败：${failVoice}`, `- 继续：${continueWhy}`);
    if (adjacent)
        lines.push(`- 相邻换戏：${adjacent}`);
    if (Array.isArray(card.mustNotCopy) && card.mustNotCopy.length)
        lines.push(`- 不可照搬：${card.mustNotCopy.join("、")}`);
    return lines.join("\n");
}
