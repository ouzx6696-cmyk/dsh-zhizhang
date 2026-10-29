#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inspiration-forge-library 引文核对（quote_check.py）

用途：拆解稿里放进引号的文字，应当是原文逐字引文。本脚本抽出拆解稿中所有引号内容
（“”「」『』以及英文双引号），去掉标点与空白后到原文里查找：
  - 逐字命中：通过；
  - 部分命中（与原文最长相同片段占引文一半以上）：多半是记错或删改了字，按原文改回；
  - 基本不命中：要么是编造的“原文”，要么是分析者自己的术语或概括——术语和概括请去掉引号。

脚本只做字面比对，不判断理解是否正确；繁简不同会导致不命中，若装有 opencc 会先统一转简体。

用法：
  python3 -B quote_check.py <原文.txt> <拆解稿.md>
  python3 -B quote_check.py <原文.txt> <拆解稿.md> --min-chars 6 --json
退出码：全部命中为 0；有未命中引文为 1；参数或文件错误为 2。只读，不写任何文件。
"""
import argparse
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')
QUOTES = re.compile(r'“([^”\n]{1,300})”|「([^」\n]{1,300})」|『([^』\n]{1,300})』|"([^"\n]{1,300})"')


def to_simplified(text):
    try:
        import opencc  # type: ignore
        return opencc.OpenCC('t2s').convert(text)
    except Exception:
        return text


def core(text):
    return ''.join(CJK.findall(to_simplified(text)))


def build_index(source_text):
    """返回去标点后的原文串，以及每个字符对应的原文行号。"""
    chars, lines = [], []
    for no, line in enumerate(source_text.splitlines(), 1):
        for ch in core(line):
            chars.append(ch)
            lines.append(no)
    return ''.join(chars), lines


def check(source_path, analysis_path, min_chars=6):
    src_text = Path(source_path).read_text(encoding='utf-8', errors='replace')
    src, line_of = build_index(src_text)
    results = []
    for no, line in enumerate(Path(analysis_path).read_text(encoding='utf-8', errors='replace').splitlines(), 1):
        for m in QUOTES.finditer(line):
            raw = next(g for g in m.groups() if g is not None)
            c = core(raw)
            if len(c) < min_chars:
                continue
            pos = src.find(c)
            if pos >= 0:
                results.append({'line': no, 'quote': raw, 'status': '逐字命中', 'source_line': line_of[pos]})
                continue
            match = SequenceMatcher(None, c, src, autojunk=False).find_longest_match(0, len(c), 0, len(src))
            ratio = match.size / len(c)
            src_line = line_of[match.b] if match.size else None
            nearby = ''
            if match.size:
                start = max(0, match.b - match.a)
                nearby = src[start:start + len(c) + 4]
            status = '部分命中' if ratio >= 0.5 else '基本不命中'
            results.append({'line': no, 'quote': raw, 'status': status, 'overlap': round(ratio, 2),
                            'source_line': src_line, 'nearest_source': nearby})
    return results


def main():
    ap = argparse.ArgumentParser(description='核对拆解稿里的引号内容是否为原文逐字引文')
    ap.add_argument('source', help='原文文件（UTF-8 纯文本）')
    ap.add_argument('analysis', help='拆解稿文件')
    ap.add_argument('--min-chars', type=int, default=6, help='引号内少于这么多汉字的不核对（默认 6）')
    ap.add_argument('--json', action='store_true', help='输出 JSON')
    a = ap.parse_args()
    for p in (a.source, a.analysis):
        if not Path(p).is_file():
            print(f'文件不存在：{p}', file=sys.stderr)
            sys.exit(2)
    res = check(a.source, a.analysis, a.min_chars)
    bad = [r for r in res if r['status'] != '逐字命中']
    if a.json:
        print(json.dumps({'checked': len(res), 'not_verbatim': len(bad), 'items': res}, ensure_ascii=False, indent=2))
    else:
        print(f'核对引文 {len(res)} 处：逐字命中 {len(res) - len(bad)}，未逐字命中 {len(bad)}。')
        for r in bad:
            print(f"- 第 {r['line']} 行［{r['status']}，重合 {r['overlap']:.0%}］“{r['quote']}”")
            if r['status'] == '部分命中':
                print(f"  原文第 {r['source_line']} 行附近：{r['nearest_source']}  → 按原文改回")
            else:
                print('  → 若是原文，找到出处逐字引用；若是自己的概括或术语，去掉引号')
        if not res:
            print('没有找到需要核对的引文。')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
