#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
novel-writer 跨文档数字与时间对照（ledger_check.py）

用途：从幕纲、章纲和正文里抽出带单位的数字（金额、数量、天数、时刻等）与相对时间词
（次日、第三天、昨天……），按单位和文件列成对照表，方便编辑核对“正文与规划是否一致、
前后章账目是否闭合”。

脚本只抽取、不判对错：同一数字出现在不同文件不等于正确，数字不同也可能是剧情变化。
结论由编辑对照上下文判断，见 references/editor_method.md 第六节“改完核旧账”。

用法：
  python3 -B ledger_check.py <作品根> --chapters C001-C003
  python3 -B ledger_check.py <作品根> --chapters C002 --json
  python3 -B ledger_check.py --files a.md b.md        # 直接指定文件
只读，不写任何文件。
"""
import argparse
import json
import re
import sys
from pathlib import Path

CN_NUM = '零〇一二两三四五六七八九十百千万'
NUM = rf'(?:\d+(?:\.\d+)?|[{CN_NUM}]+|半)'
UNITS = [
    '块钱', '元钱', '个月', '小时', '分钟', '刻钟', '个时辰', '时辰', '公里', '里地',
    '元', '块', '文', '贯', '两', '金', '钱', '万', '份', '斤', '张', '碗', '锅', '箱', '袋',
    '天', '日', '夜', '周', '年', '岁', '点', '次', '回', '人', '个', '道', '步', '米', '里',
]
UNIT_RE = '|'.join(sorted(map(re.escape, UNITS), key=len, reverse=True))
AMOUNT = re.compile(rf'(?<![第{CN_NUM}\d])({NUM})\s*({UNIT_RE})')
TIME_WORDS = re.compile(
    rf'(第{NUM}[天日夜周]|次日|翌日|隔天|第二天|当天|当晚|当夜|今早|今晚|今天|昨天|昨晚|前天|明天|明早|后天|'
    rf'[上下]午|清早|傍晚|半夜|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|'
    rf'{NUM}点(?:半|{NUM}分)?)'
)
# 太常见、几乎从不承载账目的组合，默认不列
NOISE = {('一', '个'), ('一', '次'), ('一', '回'), ('一', '步'), ('一', '道'), ('两', '个'), ('一', '点'), ('半', '个')}


def chapter_range(spec):
    m = re.fullmatch(r'C?(\d{1,4})(?:-C?(\d{1,4}))?', spec.strip(), re.I)
    if not m:
        sys.exit(f'无法解析章号范围：{spec}（示例：C001-C003）')
    a = int(m.group(1)); b = int(m.group(2) or a)
    if b < a:
        a, b = b, a
    return [f'C{i:03d}' for i in range(a, b + 1)]


def collect_files(root, chapters):
    ws = root / 'workspace'
    files = []
    acts = ws / 'acts'
    if acts.is_dir():
        files += sorted(p for p in acts.glob('*.md') if p.is_file())
    for c in chapters:
        for sub in ('outlines', 'drafts', 'chapters'):
            p = ws / sub / f'{c}.md'
            if p.is_file():
                files.append(p)
    return files


def scan(path, root=None):
    rel = str(path.relative_to(root)) if root else str(path)
    out = []
    for no, line in enumerate(path.read_text(encoding='utf-8', errors='replace').splitlines(), 1):
        if not line.strip():
            continue
        for m in AMOUNT.finditer(line):
            n, u = m.group(1), m.group(2)
            if (n, u) in NOISE:
                continue
            s, e = max(0, m.start() - 12), min(len(line), m.end() + 12)
            out.append({'file': rel, 'line': no, 'kind': '数量', 'unit': u, 'value': n + u, 'context': line[s:e].strip()})
        for m in TIME_WORDS.finditer(line):
            s, e = max(0, m.start() - 12), min(len(line), m.end() + 12)
            out.append({'file': rel, 'line': no, 'kind': '时间', 'unit': '时间词', 'value': m.group(1), 'context': line[s:e].strip()})
    return out


def render(rows, files):
    lines = ['# 跨文档数字与时间对照', '',
             '> 只抽取、不判对错。逐项对照上下文：正文与幕纲/章纲是否一致，前后章的数目、余额、天数是否接得上。', '',
             '## 扫描文件', ''] + [f'- {f}' for f in files] + ['']
    by_unit = {}
    for r in rows:
        by_unit.setdefault(r['unit'], []).append(r)
    order = sorted(by_unit, key=lambda u: (u == '时间词', -len(by_unit[u])))
    for u in order:
        lines += [f'## {u}', '', '| 文件 | 行 | 值 | 上下文 |', '|---|---|---|---|']
        for r in by_unit[u]:
            ctx = r['context'].replace('|', '｜')
            lines.append(f"| {r['file']} | {r['line']} | {r['value']} | {ctx} |")
        values = {}
        for r in by_unit[u]:
            values.setdefault(r['value'], set()).add(r['file'])
        if u != '时间词' and 1 < len(values) <= 8:
            lines += ['', '同一单位出现的不同数值：' + '；'.join(f'{v}（{len(fs)} 个文件）' for v, fs in values.items())]
        elif u != '时间词' and len(values) > 8:
            lines += ['', f'同一单位共有 {len(values)} 种数值，请按上表逐行核对。']
        lines.append('')
    if not rows:
        lines.append('未抽到带单位的数字或时间词。')
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description='跨文档数字与时间对照（只抽取、不判对错）')
    ap.add_argument('root', nargs='?', help='作品根（含 workspace/）')
    ap.add_argument('--chapters', help='章号或范围，如 C002 或 C001-C003')
    ap.add_argument('--files', nargs='+', help='直接指定要对照的文件，忽略作品根结构')
    ap.add_argument('--json', action='store_true', help='输出 JSON')
    a = ap.parse_args()
    if a.files:
        paths = [Path(f) for f in a.files]
        missing = [str(p) for p in paths if not p.is_file()]
        if missing:
            sys.exit('文件不存在：' + '、'.join(missing))
        root = None
    else:
        if not a.root or not a.chapters:
            ap.error('需要 <作品根> 和 --chapters，或改用 --files')
        root = Path(a.root).resolve()
        if not (root / 'workspace').is_dir():
            sys.exit(f'没有 workspace/ 目录：{root}')
        paths = collect_files(root, chapter_range(a.chapters))
        if not paths:
            sys.exit('指定范围内没有找到幕纲、章纲、草稿或定稿文件')
    rows = []
    for p in paths:
        rows += scan(p, root)
    names = [str(p.relative_to(root)) if root else str(p) for p in paths]
    if a.json:
        print(json.dumps({'files': names, 'items': rows}, ensure_ascii=False, indent=2))
    else:
        print(render(rows, names))


if __name__ == '__main__':
    main()
