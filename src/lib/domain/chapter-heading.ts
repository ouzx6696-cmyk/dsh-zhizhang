// @ts-nocheck
/**
 * 章 / 卷标题解析 — 全插件唯一来源。
 *
 * 支持：第1章 / 第001章 / 第一章 / 第两百章 / 序章 / 序 / 楔子 / 引子。
 * 只认行首标题，避免正文里的「第一章」误切。
 */

const CN_DIGITS = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_UNITS = { 十: 10, 百: 100, 千: 1000 };
const NUM_CHARS = "0-9０-９一二三四五六七八九十百千万零〇两";

function asciiDigits(s) {
    return s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
}

/** 中文数字 / 阿拉伯数字 → number；无法解析返回 NaN。 */
export function cnNumber(input) {
    const t = String(input ?? "").trim();
    if (!t)
        return NaN;
    if (/^[0-9０-９]+$/.test(t))
        return Number(asciiDigits(t));
    if (!new RegExp(`^[${NUM_CHARS}]+$`).test(t))
        return NaN;
    // 逐字写法（一二三）按拼接处理；含单位时走单位算法。
    if (!/[十百千万]/.test(t)) {
        const digits = [...t].map((ch) => CN_DIGITS[ch]);
        if (digits.some((d) => d === undefined))
            return NaN;
        return Number(digits.join(""));
    }
    let total = 0;
    let section = 0;
    let number = 0;
    for (const ch of t) {
        if (ch in CN_DIGITS) {
            number = CN_DIGITS[ch];
            continue;
        }
        if (ch === "万") {
            total += (section + number) * 10000;
            section = 0;
            number = 0;
            continue;
        }
        const unit = CN_UNITS[ch];
        if (!unit)
            return NaN;
        if (unit === 10 && number === 0)
            number = 1;
        section += number * unit;
        number = 0;
    }
    return total + section + number;
}

/** 行首章节标题：第N章 / 第N回 / 第N节（N 可为中文数字）。 */
export const CHAPTER_HEADING_RE = new RegExp(
    `^[ \\t]*第([${NUM_CHARS}]+)[章回节][ \\t]*(.*)$`,
    "gm",
);

/** 行首卷标题：第N卷。 */
export const VOLUME_HEADING_RE = new RegExp(
    `^[ \\t]*第([${NUM_CHARS}]+)卷[ \\t]*(.*)$`,
    "gm",
);

/** 行首前置章节：序章 / 序 / 楔子 / 引子。 */
export const FRONT_HEADING_RE = /^[ \t]*(序章|序|楔子|引子)[ \t]*(.*)$/gm;

/** 解析一行标题；不是章节标题返回 null。 */
export function parseChapterHeading(line) {
    const raw = String(line ?? "");
    const m = new RegExp(`^[ \\t]*第([${NUM_CHARS}]+)[章回节][ \\t]*(.*)$`).exec(raw);
    if (m) {
        const n = cnNumber(m[1]);
        if (Number.isFinite(n))
            return { n, title: (m[2] ?? "").trim(), kind: "chapter" };
        return null;
    }
    const front = /^[ \t]*(序章|序|楔子|引子)[ \t]*(.*)$/.exec(raw);
    if (front)
        return { n: 0, title: `${front[1]} ${(front[2] ?? "").trim()}`.trim(), kind: "front" };
    return null;
}

/** 把「第12章」「第十二章」「12」统一成 number；解析失败返回 NaN。 */
export function parseChapterNumber(label) {
    const t = String(label ?? "").trim();
    if (!t)
        return NaN;
    if (/^(序章|序|楔子|引子)$/.test(t))
        return 0;
    const m = new RegExp(`第?\\s*([${NUM_CHARS}]+)\\s*[章回节]?`).exec(t);
    if (!m)
        return NaN;
    return cnNumber(m[1]);
}
