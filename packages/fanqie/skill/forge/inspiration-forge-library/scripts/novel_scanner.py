#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
长篇小说文本测绘工具 (novel_scanner.py)
用途：读取 TXT/Markdown 本地小说文件，识别候选卷章标题，统计非空白字符与
指定关键词次数，提取章末片段。章末标签来自词语规则，仅作定位提示。
"""
import argparse
import json
import os
import re
from collections import Counter

CHAPTER_PAT = re.compile(
    r"^\s*(?:#{1,4}\s*)?(序章|楔子|引子|尾声|番外.*|C[0-9]{3,4}[\s·:：].*|第[零一二三四五六七八九十百千万0-9]{1,6}[章节回幕折]\s*.*)$"
)
VOLUME_PAT = re.compile(
    r"^\s*(?:#{1,4}\s*)?(第[零一二三四五六七八九十百0-9]{1,4}[卷部篇集]\s*.*)$"
)
HOOK_PATTERNS = {
    "悬念提问型": re.compile(r"[？?]|到底|究竟|是谁|怎么会"),
    "危机降临型": re.compile(r"不好|完了|快跑|杀|死|血|猛地|骤然|轰|警报"),
    "反转揭秘型": re.compile(r"竟然|居然|原来|根本不是|而是|露出|真正的"),
    "收获期待型": re.compile(r"到账|突破|成了|系统|奖励|到手|发财|归我"),
}

def read_text_auto(file_path):
    for enc in ("utf-8", "utf-8-sig", "gb18030", "gbk", "utf-16"):
        try:
            with open(file_path, "r", encoding=enc) as f:
                return f.read(), enc
        except UnicodeDecodeError:
            continue
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        return f.read(), "utf-8-replace"

def classify_hook(last_lines_text):
    matched = [name for name, pat in HOOK_PATTERNS.items() if pat.search(last_lines_text)]
    return "+".join(matched) if matched else "余韵/动作落点型"

def scan_novel(file_path, top_n_chapters=10, keywords=None):
    text, encoding = read_text_auto(file_path)
    lines = text.splitlines()
    total_chars = len(re.sub(r"\s+", "", text))

    volumes = []
    chapters = []
    for idx, line in enumerate(lines):
        s = line.strip()
        if not s or len(s) > 60:
            continue
        if VOLUME_PAT.match(s):
            volumes.append({"line": idx + 1, "title": s})
        elif CHAPTER_PAT.match(s):
            chapters.append({"line": idx + 1, "title": s})

    chapter_details = []
    for i, ch in enumerate(chapters):
        start_line = ch["line"]
        end_line = chapters[i + 1]["line"] - 1 if i + 1 < len(chapters) else len(lines)
        body_lines = [l.strip() for l in lines[start_line:end_line] if l.strip()]
        body_text = "\n".join(body_lines)
        char_count = len(re.sub(r"\s+", "", body_text))
        last_three = body_lines[-3:] if len(body_lines) >= 3 else body_lines
        last_text = " / ".join(last_three)
        chapter_details.append({
            "index": i + 1,
            "title": ch["title"],
            "start_line": start_line,
            "end_line": end_line,
            "char_count": char_count,
            "para_count": len(body_lines),
            "hook_type": classify_hook(last_text),
            "ending_anchor": last_text[:120],
        })

    kw_stats = {}
    if keywords:
        for kw in keywords:
            kw = kw.strip()
            if kw:
                kw_stats[kw] = text.count(kw)

    avg_chars = (
        round(sum(c["char_count"] for c in chapter_details) / len(chapter_details))
        if chapter_details else total_chars
    )

    result = {
        "file": os.path.basename(file_path),
        "encoding": encoding,
        "total_non_whitespace_chars": total_chars,
        "total_lines": len(lines),
        "volume_count": len(volumes),
        "chapter_count": len(chapter_details),
        "avg_chapter_chars": avg_chars,
        "volumes": volumes[:30],
        "keyword_frequencies": kw_stats,
        "golden_opening_chapters": chapter_details[:top_n_chapters],
        "milestone_anchors": {
            "first_3": chapter_details[:3],
            "ch_10": chapter_details[9] if len(chapter_details) >= 10 else None,
            "mid_point": chapter_details[len(chapter_details) // 2] if chapter_details else None,
            "last_chapter": chapter_details[-1] if chapter_details else None,
        },
    }
    return result

def main():
    parser = argparse.ArgumentParser(description="番茄拆书库长篇小说全局量化测绘工具")
    parser.add_argument("file", help="小说 TXT 或 MD 文件路径")
    parser.add_argument("--top", type=int, default=10, help="展示前 N 章的开篇明细 (默认 10)")
    parser.add_argument("--keywords", type=str, default="", help="逗号分隔的待统计核心人物/道具/设定词")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    args = parser.parse_args()

    kws = [k for k in args.keywords.split(",") if k.strip()] if args.keywords else []
    res = scan_novel(args.file, top_n_chapters=args.top, keywords=kws)

    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    print(f"# 《{res['file']}》全局量化测绘报告")
    print(f"- 编码格式: `{res['encoding']}` | 总非空白字符数: `{res['total_non_whitespace_chars']}` | 总行数: `{res['total_lines']}`")
    print(f"- 分卷数量: `{res['volume_count']}` | 识别章数: `{res['chapter_count']}` | 章均非空白字符数: `{res['avg_chapter_chars']}`")
    if res["keyword_frequencies"]:
        print("\n## 指定关键词出现次数")
        for k, v in sorted(res["keyword_frequencies"].items(), key=lambda x: -x[1]):
            print(f"- **{k}**: {v} 次")
    if res["golden_opening_chapters"]:
        print(f"\n## 前 {len(res['golden_opening_chapters'])} 章开篇明细与章末片段")
        print("| 章序 | 标题 | 行号范围 | 非空白字符数 | 段落数 | 章末类型（词语规则提示） | 章末三行 |")
        print("| :--- | :--- | :--- | ---: | ---: | :--- | :--- |")
        for ch in res["golden_opening_chapters"]:
            print(f"| C{ch['index']:03d} | {ch['title']} | L{ch['start_line']}-{ch['end_line']} | {ch['char_count']} | {ch['para_count']} | {ch['hook_type']} | {ch['ending_anchor']} |")

if __name__ == "__main__":
    main()
