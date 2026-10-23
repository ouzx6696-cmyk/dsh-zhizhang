/**
 * 拆书 L0 量化测绘（v0.17.0）。
 *
 * 目的：在动用模型精读之前，先用代码把「可确定性统计」的东西扫一遍——
 * 卷界、章长、词频、分布热力、锚点章。报告里的宏观判断必须踩在这些数字上，
 * 而不是踩在抽样印象上。
 *
 * 本文件纯计算，不读写磁盘；analysis.js 负责落盘。
 */
import { cnNumber, VOLUME_HEADING_RE } from "../domain/chapter-heading.js";
export { cnNumber };
/** 解析卷标记行：第一卷 / 第二卷 … 返回 [{no,name,title,start,end}]。 */
export function parseVolumes(text) {
    const t = String(text ?? "");
    const marks = [];
    const re = new RegExp(VOLUME_HEADING_RE.source, VOLUME_HEADING_RE.flags);
    let m;
    while ((m = re.exec(t))) {
        marks.push({ no: cnNumber(m[1]), name: `第${m[1]}卷`, title: (m[2] ?? "").trim(), start: m.index, end: t.length });
    }
    for (let i = 0; i < marks.length; i++)
        marks[i].end = i + 1 < marks.length ? marks[i + 1].start : t.length;
    return marks;
}
const STOP_CHARS = new Set("的了是在我他她它们这那就都也不没有和与很太又再才只把被让给对从向于以为所之其而但却吗呢吧啊呀哦嗯个一不你您咱谁什怎多少几着过地得".split(""));
/** 高频噪声词：常用动词/副词/代词，避免把「已经/好像」当实体。 */
const STOP_WORDS = new Set(`自己 已经 好像 时候 最后 起来 知道 开始 能够 如此 无数 看到 声音 抬起 东西 想要 竟然 然后 看着 浮现 黑暗 眼睛 接着 随着 紧接 灵魂 感觉 仿佛 时间 力量 世界 出来 任何 依旧 甚至 面孔 哪怕 庞大 来自 事情 下来 迅速 手中 无法 应该 宛如 眼前 缓缓 过来 如今 究竟 渐渐 什么 怎么 这个 那个 一个 一下 一样 一切 一起 一直 一定 一般 一边 这种 那种 这些 那些 这里 那里 这样 那样 现在 当时 刚才 突然 忽然 果然 居然 仍然 立刻 马上 顿时 随即 随后 终于 总是 始终 依然 仍旧 只是 不过 而且 或者 还是 因为 所以 如果 虽然 但是 于是 由于 对于 关于 通过 根据 按照 沿着 除了 直到 以及 并且 尤其 特别 非常 十分 极其 格外 更加 有点 有些 许多 很多 不少 大量 全部 所有 整个 每个 各种 各自 其他 其余 另外 此外 同时 此时 此刻 这时 那时 之后 之前 以后 以前 里面 外面 上面 下面 前面 后面 旁边 中间 周围 附近 地方 东西 事情 问题 办法 方法 样子 感觉 心里 心中 内心 眼神 目光 视线 声音 语气 表情 神色 脸上 嘴角 身体 身上 手里 脚下 面前 身后 背后 头顶 天空 地面 空气 光线 阳光 月光 灯光 火光 鲜血 血液 伤口 骨头 肌肉 皮肤 头发 衣服 口袋 手指 手臂 肩膀 脖子 胸口 肚子 双腿 双脚 脚步 方向 位置 距离 速度 温度 颜色 形状 大小 高低 长短 快慢 轻重 强弱 多少 几个 第一 第二 第三 一次 两次 三次 一天 两天 三天 一年 两年 三年 一会儿 片刻 瞬间 刹那 转眼 很快 很久 不久 早已 早就 刚刚 正好 恰好 偏偏 反而 反倒 难道 简直 几乎 差点 差不多 大概 大约 也许 或许 可能 似乎 貌似 恐怕 难免 未免 不免 不禁 不由得 忍不住 只好 只能 只得 不得不 千万 万万 绝对 肯定 必然 一定 确实 的确 实在 真的 真是 显然 当然 自然 彻底 扩散 地上 回头 变成 大地 微笑 眼瞳 响起 毫无 大家 事儿 露出 摇头 曾经 带着 骤然 神情 出现 倘若 原本 根本 笑容 进行 光芒 笼罩 未曾 消失 需要 许久 哪里 准备 进行 需要 出现 曾经 大家 事儿 变成 微笑 眼瞳 响起 毫无 露出 摇头 带着 骤然 神情 倘若 原本 根本 笑容 光芒 笼罩 未曾 消失 恐怖 沉默 觉到 凝视 升起 察觉 意识 观察 注视 望向 抬头 低头 转身 点头 皱眉 呼吸 心跳 身边 四周 远处 近处 眼中 眼底`.split(/\s+/).filter(Boolean));
/**
 * 统计高频词（2–4 字 n-gram）。
 * 只做「分布参考」，不做实体识别；人名/地名/概念混排，报告里必须如实标注。
 */
export function topTerms(text, { minCount = 30, limit = 40 } = {}) {
    const t = String(text ?? "");
    const map = new Map();
    const re = /[\u4e00-\u9fa5]+/g;
    let m;
    while ((m = re.exec(t))) {
        const s = m[0];
        for (let i = 0; i < s.length; i++) {
            const max = Math.min(4, s.length - i);
            for (let len = 2; len <= max; len++) {
                let ok = true;
                for (let k = i; k < i + len; k++) {
                    if (STOP_CHARS.has(s[k])) {
                        ok = false;
                        break;
                    }
                }
                if (!ok)
                    continue;
                const g = s.slice(i, i + len);
                map.set(g, (map.get(g) || 0) + 1);
            }
        }
    }
    let rows = [...map.entries()].filter(([k, c]) => c >= minCount && !STOP_WORDS.has(k));
    rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // 嵌套去重：若短词与更长的词频次完全相同，保留长词（如「升华者」压掉「华者」）。
    const top = rows.slice(0, 500);
    rows = rows.filter(([k, c]) => {
        if (!top.some(([t2]) => t2 === k))
            return true;
        for (const [k2, c2] of top) {
            if (k2.length > k.length && c2 === c && k2.includes(k))
                return false;
        }
        return true;
    });
    return rows.slice(0, limit).map(([term, count]) => ({ term, count }));
}
const ANCHOR_RE = /(决战|真相|牺牲|背叛|晋升|突破|最后|结束|开始|告白|重逢|葬礼|遗产|遗言|决裂|宣战|复仇|死亡|死|杀|救|婚礼|告别)/g;
/** 锚点章：关键词密度 + 事实钩子强度 + 卷首卷末加成。 */
export function anchorChapters(text, index, { facts = [], volumes = [], limit = 60 } = {}) {
    const factMap = new Map((facts ?? []).map((f) => [f.n, f]));
    const firsts = new Set(volumes.map((v) => v.from));
    const lasts = new Set(volumes.map((v) => v.to));
    const rows = [];
    for (const c of index) {
        if (!(c.n > 0))
            continue;
        const body = String(text).slice(c.start, c.end);
        const chars = body.replace(/\s/g, "").length || 1;
        ANCHOR_RE.lastIndex = 0;
        let hits = 0;
        while (ANCHOR_RE.exec(body))
            hits++;
        const density = (hits / chars) * 1000;
        const hook = factMap.get(c.n)?.hook?.strength;
        const score = density + (hook === "强" ? 3 : hook === "中" ? 1 : 0) + (firsts.has(c.n) ? 2 : 0) + (lasts.has(c.n) ? 2 : 0);
        if (score > 0)
            rows.push({ n: c.n, title: c.title, score: Number(score.toFixed(2)), why: `关键词 ${hits} 次${hook === "强" ? " · 强钩子" : ""}${firsts.has(c.n) ? " · 卷首" : ""}${lasts.has(c.n) ? " · 卷末" : ""}` });
    }
    rows.sort((a, b) => b.score - a.score || a.n - b.n);
    return rows.slice(0, limit);
}
/** 主入口：全书测绘。 */
export function buildSurvey(text, index, { facts = [], volumeMarkers } = {}) {
    const t = String(text ?? "");
    const volumes = volumeMarkers ?? parseVolumes(t);
    const chapters = index.filter((c) => c.n > 0);
    const chars = chapters.map((c) => t.slice(c.start, c.end).replace(/\s/g, "").length);
    const totalChars = chars.reduce((a, b) => a + b, 0);
    const volRows = volumes.map((v) => {
        const inside = chapters.filter((c) => c.start >= v.start && c.start < v.end);
        return {
            no: v.no,
            name: v.name,
            title: v.title,
            from: inside[0]?.n ?? null,
            to: inside[inside.length - 1]?.n ?? null,
            chapters: inside.length,
            chars: inside.reduce((a, c) => a + t.slice(c.start, c.end).replace(/\s/g, "").length, 0),
            firstTitle: inside[0]?.title ?? "",
            lastTitle: inside[inside.length - 1]?.title ?? "",
        };
    });
    const dialogue = (t.match(/“[^”]*”|「[^」]*」/g) ?? []).join("").length;
    const terms = topTerms(t, { limit: 40 });
    const buckets = 10;
    const size = Math.max(1, Math.ceil(chapters.length / buckets));
    const heatTerms = terms.slice(0, 8);
    const heatmap = {
        buckets,
        size,
        rows: heatTerms.map(({ term }) => {
            const counts = new Array(buckets).fill(0);
            for (const c of chapters) {
                const b = Math.min(buckets - 1, Math.floor((c.n - 1) / size));
                const body = t.slice(c.start, c.end);
                let k = 0;
                let p = -1;
                while ((p = body.indexOf(term, p + 1)) >= 0)
                    k++;
                counts[b] += k;
            }
            return { term, counts };
        }),
    };
    return {
        schemaVersion: 2,
        createdAt: new Date().toISOString(),
        totalChars,
        rawChars: t.length,
        lines: t.split("\n").length,
        chapterCount: chapters.length,
        avgChapterChars: chapters.length ? Math.round(totalChars / chapters.length) : 0,
        minChapterChars: chars.length ? Math.min(...chars) : 0,
        maxChapterChars: chars.length ? Math.max(...chars) : 0,
        dialogueRatio: totalChars ? Number((dialogue / totalChars).toFixed(3)) : 0,
        volumes: volRows,
        terms,
        heatmap,
        anchors: anchorChapters(t, index, { facts, volumes, limit: 60 }),
    };
}
