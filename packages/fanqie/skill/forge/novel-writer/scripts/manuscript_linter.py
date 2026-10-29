#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
novel-writer 正文体检（manuscript_linter.py）
用途：
1. 统计正文字数（去标题与空白）、段落数、段均字数、超长段（默认 >160 字，可用 --long-para 调整）与超短段占比。
2. 标出七类常见套话的位置（辩证翻案、五官套话、情绪直判、高频虚词、过程跳步、自我限定、章末口号）。
3. 命中只是“值得回看的位置”，不是错误判定：按 references/editor_method.md 第三、六节，没有症状就不改。
   台词（引号内）里的命中单独列出，人物口语通常应保留。
"""
import argparse
import json
import os
import re

AI_PATTERNS = {
    "辩证翻案套话": [
        r"不是[^。！？]{1,20}?而是",
        r"与其说是[^。！？]{1,20}?不如说是",
        r"不仅仅?是[^，。！？]{1,20}更是",
    ],
    "五官情绪套话": [
        r"眼中闪过一[丝抹道]",
        r"嘴角勾起一[丝抹]",
        r"瞳孔[猛骤]?[地然]?一缩",
        r"倒吸一?口?[凉冷]气",
        r"嘴角抽搐",
    ],
    "抽象情绪直判/认知前置": [
        r"心中涌起一[股阵丝]",
        r"感到一[阵股丝][^，。！？]{1,8}(愤怒|绝望|寒意|悲凉|欣喜|不安)",
        r"他(忽然|突然)?(意识到|察觉到|感受到|深刻地明白)",
        r"深深地?(意识到|明白)",
        r"一股(难以言喻|莫名|前所未有)的",
    ],
    "高频AI虚词泛滥": [
        r"一[丝抹]不易察觉",
        r"几分[^，。！？]{1,6}之色",
        r"不由得",
        r"不禁",
        r"与此同时",
    ],
    "过程跳步偷懒": [
        r"经过一番(激烈|艰难|漫长)?的?(交涉|搏斗|争论|思索|心理斗争)",
        r"很快便(处理|安排|解决)妥当",
        r"不知过了多久",
    ],
    "自我限定/解释过密": [
        r"(?:还|暂时|目前|一时)?(?:不能|无法)(?:确定|断定|判断|证明)",
        r"并不(?:意味着|代表|等于|说明)",
        r"只能(?:说明|证明)",
        r"(?:或许|也许)只是",
        r"不排除",
    ],
    "章末口号/拔高": [
        r"属于他的[^，。！？]{1,10}才刚刚开始",
        r"真正的[^，。！？]{1,10}终究会",
        r"命运的齿轮",
        r"在这一刻[^，。！？]{1,15}得到了升华",
    ],
}

QUOTE_RE = re.compile(r'“[^”]*”|「[^」]*」|"[^"]*"')


def _in_dialogue(line, start, end):
    for q in QUOTE_RE.finditer(line):
        if q.start() <= start and end <= q.end():
            return True
    return False


def lint_file(file_path, long_para=160):
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        raw_lines = f.read().splitlines()

    title = ""
    body_lines = []
    for idx, line in enumerate(raw_lines):
        s = line.strip()
        if not s:
            continue
        if not title and (s.startswith("#") or re.match(r"^第[零一二三四五六七八九十百千万0-9]+[章节]", s)):
            title = s.lstrip("#").strip()
            continue
        body_lines.append((idx + 1, s))

    full_body = "".join(s for _, s in body_lines)
    total_chars = len(re.sub(r"\s+", "", full_body))
    cjk_chars = len(re.findall(r"[\u4e00-\u9fff]", full_body))
    para_count = len(body_lines)
    avg_para_len = round(total_chars / para_count, 1) if para_count else 0

    long_paras = [(ln, len(s), s[:40] + "...") for ln, s in body_lines if len(s) > long_para]
    short_paras = [ln for ln, s in body_lines if len(s) <= 12]
    short_ratio = round(len(short_paras) / para_count * 100, 1) if para_count else 0

    ai_hits = []
    dialogue_hits = []
    for ln, s in body_lines:
        for cat, pats in AI_PATTERNS.items():
            for pat in pats:
                for m in re.finditer(pat, s):
                    hit = {
                        "line": ln,
                        "category": cat,
                        "matched": m.group(0),
                        "context": s[:90] + ("..." if len(s) > 90 else ""),
                    }
                    (dialogue_hits if _in_dialogue(s, m.start(), m.end()) else ai_hits).append(hit)

    # Check last 2 paragraphs for ending quality
    ending_paras = [s for _, s in body_lines[-2:]] if len(body_lines) >= 2 else [s for _, s in body_lines]

    return {
        "file": os.path.basename(file_path),
        "title": title or "(未检测到首行标题)",
        "total_chars": total_chars,
        "cjk_chars": cjk_chars,
        "para_count": para_count,
        "avg_para_chars": avg_para_len,
        "short_para_ratio_pct": short_ratio,
        "overlong_paragraphs": long_paras,
        "long_para_threshold": long_para,
        "ai_cliche_count": len(ai_hits),
        "ai_cliches": ai_hits,
        "dialogue_hit_count": len(dialogue_hits),
        "dialogue_hits": dialogue_hits,
        "ending_preview": ending_paras,
    }

def main():
    parser = argparse.ArgumentParser(description="正文体检：字数、长段与常见套话位置（命中仅作回看提示）")
    parser.add_argument("files", nargs="+", help="待检测的正文文件路径")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    parser.add_argument("--long-para", type=int, default=160, help="超长段阈值（字），默认 160")
    args = parser.parse_args()

    reports = [lint_file(f, args.long_para) for f in args.files]
    if args.json:
        print(json.dumps(reports, ensure_ascii=False, indent=2))
        return

    for r in reports:
        print("=" * 60)
        print(f"文件：{r['file']}｜标题：{r['title']}")
        print("=" * 60)
        print(f"- 字数：非空字符 {r['total_chars']}｜汉字 {r['cjk_chars']}")
        print(f"- 段落：{r['para_count']} 段｜段均 {r['avg_para_chars']} 字｜超短段占比 {r['short_para_ratio_pct']}%")
        if r["overlong_paragraphs"]:
            print(f"- 超长段 {len(r['overlong_paragraphs'])} 个（>{r['long_para_threshold']} 字，手机上可考虑按视角或动作切段）：")
            for ln, length, preview in r["overlong_paragraphs"]:
                print(f"  * [L{ln}]（{length} 字）{preview}")
        else:
            print(f"- 没有超过 {r['long_para_threshold']} 字的段落。")
        if r["ai_cliches"]:
            print(f"- 叙述里的套话位置 {r['ai_cliche_count']} 处（回看提示：有症状才改，见 editor_method.md 第三、六节）：")
            for h in r["ai_cliches"]:
                print(f"  * [L{h['line']}]［{h['category']}］{h['matched']} ← {h['context']}")
        else:
            print("- 叙述里未命中常见套话（不等于没有问题，内容仍按四类硬伤和 L1–L3 审）。")
        if r["dialogue_hits"]:
            print(f"- 台词里的命中 {r['dialogue_hit_count']} 处（人物口语通常保留）：")
            for h in r["dialogue_hits"]:
                print(f"  * [L{h['line']}]［{h['category']}］{h['matched']}")
        print(f"- 章末预览：{' // '.join(r['ending_preview'])}")
        print()


if __name__ == "__main__":
    main()
