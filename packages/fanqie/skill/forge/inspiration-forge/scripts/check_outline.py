#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""可选章纲机械检查：format 查接口；readiness 再查空值、显式占位和本地文件链接。
不判断动机、因果、实际可写性、授权或文学质量。只有 Python 3.10+ 标准库。
"""
from pathlib import Path
import argparse
import json
import os
import re
import stat
from urllib.parse import unquote, urlsplit

BLOCKS = ('剧情梗概', '核心冲突与看点', '情节推进节点', '章末落点')
FIELDS = ('视角', '目标篇幅', '锁定事实', '人物知识边界')
EXPECTED = [f'{index}. {block}' for index, block in enumerate(BLOCKS, 1)]


def sequence_issues(paths, prefix, label):
    numbers = sorted(int(path.stem[1:]) for path in paths
                     if re.fullmatch(prefix + r'\d+', path.stem))
    if not numbers:
        return []
    issues = []
    if len(numbers) != len(set(numbers)):
        issues.append(f'{label} 存在重复编号')
    # Range descriptions avoid allocating billions of integers for a typo.
    unique = sorted(set(numbers))
    gaps = [(a + 1, b - 1) for a, b in zip(unique, unique[1:]) if b - a > 1]
    if gaps:
        shown = ', '.join(str(a) if a == b else f'{a}–{b}' for a, b in gaps[:20])
        if len(gaps) > 20:
            shown += '…'
        issues.append(f'{label} 区间内缺号 [{shown}]（若有意节选，请自行确认）')
    return issues


def _mask(text):
    """Do not treat examples inside fenced code or comments as real headings."""
    text = re.sub(r'<!--.*?-->', lambda m: '\n' * m.group().count('\n'), text, flags=re.S)
    lines, marker = [], None
    for line in text.splitlines():
        fence = re.match(r'^\s*(`{3,}|~{3,})', line)
        if fence:
            if marker is None:
                marker = fence.group(1)[0]
            elif fence.group(1)[0] == marker:
                marker = None
            lines.append('')
        else:
            lines.append('' if marker else line)
    return '\n'.join(lines)


def _parts(text):
    masked = _mask(text)
    matches = list(re.finditer(r'^##\s+(.+?)\s*$', masked, re.M))
    head = masked[:matches[0].start()] if matches else masked
    sections = [(match.group(1), masked[match.end():matches[i+1].start() if i+1 < len(matches) else len(masked)])
                for i, match in enumerate(matches)]
    return masked, head, sections


def _format_text(text, name):
    _, head, sections = _parts(text)
    issues = []
    for field in FIELDS:
        if not re.search(r'^\s*(?:>\s*)?(?:[-*]\s*)?' + re.escape(field) + r'\s*[:：]', head, re.M):
            issues.append(f'{name} 头注缺 {field}')
    headings = [label for label, _ in sections]
    for heading, block in zip(EXPECTED, BLOCKS):
        if headings.count(heading) != 1:
            issues.append(f'{name} 缺正文块 {block} 或标题重复／不精确')
    if headings != EXPECTED:
        issues.append(f'{name} 正文标题须按约定的四块顺序，不能用说明标题冒充')
    return issues


def _linked(path):
    """Read-only checker must not follow links while examining project inputs."""
    for part in [path] + list(path.parents):
        try:
            item = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(item.st_mode) or bool(getattr(item, 'st_file_attributes', 0) & 0x400):
            return True
    return False


def _paths(root):
    outlines = root / 'workspace/outlines'
    if _linked(outlines):
        return [], [f'章纲路径包含链接/目录联接，未读取：{outlines}']
    if not outlines.is_dir():
        return [], [f'没有章纲目录：{outlines}；若本轮不交章纲，无需运行本检查']
    paths = sorted(path for path in outlines.glob('*.md') if re.fullmatch(r'C\d+', path.stem))
    return paths, [] if paths else ['未找到 C编号.md 章纲；若本轮不交章纲，无需运行本检查']


def check(root):
    """Check the four required headers and ordered outline sections."""
    root = Path(os.path.abspath(root))
    if not root.is_dir():
        return [f'作品根不存在：{root}']
    paths, issues = _paths(root)
    if issues:
        return issues
    issues.extend(sequence_issues(paths, 'C', '章纲'))
    for folder, prefix, label in (('volumes', 'V', '卷纲'), ('acts', 'A', '幕纲')):
        directory = root / 'workspace' / folder
        if _linked(directory):
            issues.append(f'{label} 路径包含链接，未读取')
        elif directory.is_dir():
            issues.extend(sequence_issues(list(directory.glob('*.md')), prefix, label))
    for path in paths:
        if _linked(path):
            issues.append(f'{path.name} 是链接，未读取')
            continue
        try:
            issues.extend(_format_text(path.read_text(encoding='utf-8'), path.name))
        except (OSError, UnicodeError) as exc:
            issues.append(f'{path.name} 读取失败：{type(exc).__name__}')
    return issues


def _empty(value):
    return not re.sub(r'[\s>#*`_\-—:：|]+', '', value)


def _placeholders(text):
    # Narrow, explicit markers only. Ordinary Chinese bracketed prose is not a gate.
    hits = re.findall(r'\b(?:TODO|TBD)\b|待填写|待填充|待正文发挥|(?m:^\s*待补\s*$)', text)
    for token in re.findall(r'【([^】]*)】', text):
        if not token.strip() or re.search(r'待填|待补|填写|在此|工作标题|本章叙述位置|本章计划篇幅|本章相关作者锁定|各主要人物可知|本章主要经历|本章让读者经历|按实际经历组织|本章结果或体验|主要人物.*边界', token):
            hits.append('【' + token + '】')
    return hits


def inspect(root, mode='readiness'):
    """Structured mechanical report. Legacy unknown layouts require manual review."""
    if mode not in ('format', 'readiness'):
        raise ValueError('mode must be format or readiness')
    root = Path(os.path.abspath(root))
    issues = []
    count = 0
    manual = False

    def add(severity, code, message, path=''):
        issues.append({'severity': severity, 'code': code, 'path': path, 'message': message})

    if mode == 'format':
        for message in check(root):
            add('error', 'format', message)
        paths = _paths(root)[0] if root.is_dir() else []
        count = len(paths)
    elif not root.is_dir():
        add('error', 'missing_root', f'作品根不存在：{root}')
    elif _linked(root / 'workspace/outlines'):
        add('error', 'unsafe_path', '章纲路径包含链接或目录联接，未读取')
    else:
        paths, missing = _paths(root)
        count = len(paths)
        if missing:
            add('not_applicable', 'no_outlines', missing[0])
        for message in sequence_issues(paths, 'C', '章纲'):
            add('error' if '重复' in message else 'warning', 'sequence', message)
        for folder, prefix, label in (('volumes', 'V', '卷纲'), ('acts', 'A', '幕纲')):
            directory = root / 'workspace' / folder
            if _linked(directory):
                add('warning', 'unsafe_optional_path', f'{label}包含链接，未检查')
            elif directory.is_dir():
                for message in sequence_issues(list(directory.glob('*.md')), prefix, label):
                    add('error' if '重复' in message else 'warning', 'sequence', message)
            else:
                add('not_applicable', 'optional_layer', f'无{label}目录；本轮可不需要')
        for path in paths:
            rel = path.relative_to(root).as_posix()
            if _linked(path):
                add('error', 'unsafe_path', '章纲是链接，未读取', rel)
                continue
            try:
                text = path.read_text(encoding='utf-8')
            except (OSError, UnicodeError) as exc:
                add('error', 'unreadable', f'无法读取UTF-8章纲：{type(exc).__name__}', rel)
                continue
            masked, head, sections = _parts(text)
            if _empty(masked):
                add('error', 'empty_document', '章纲为空', rel)
                continue
            headings = [label for label, _ in sections]
            canonical = headings == EXPECTED
            normalize = lambda h: re.sub(r'^(?:[1-4][.、．]\s*|[一二三四][、.．]\s*)', '', h)
            normalized = [normalize(h) for h in headings]
            if not canonical:
                manual = True
                if len(headings) != len(set(headings)) or any(h in EXPECTED for h in headings):
                    add('error', 'malformed_blocks', '现行格式存在缺块、重复或额外标题；不能用说明代替正文', rel)
                code = 'variant_layout' if normalized == list(BLOCKS) else 'unmapped_layout'
                add('warning', code, '非标准容器需人工核语义对应；内容充分就直接使用，不为机械检查批量改写', rel)
            for field in FIELDS:
                found = re.search(r'^\s*(?:>\s*)?(?:[-*]\s*)?' + re.escape(field) + r'[ \t]*[:：]([^\n]*)$', head, re.M)
                if not found:
                    add('error' if canonical else 'warning', 'missing_field', f'未定位头注 {field}；需人工核是否已用其他写法表达', rel)
                elif _empty(found.group(1)):
                    add('error', 'empty_field', f'头注 {field} 为空；合法“无额外锁定”可以明写', rel)
            for label, content in sections:
                if normalize(label) in BLOCKS and _empty(content):
                    add('error', 'empty_section', f'正文块 {label} 为空', rel)
            if _placeholders(masked):
                add('error', 'placeholder', '发现显式未填占位；若确为原文引用，请人工核，不自动修改', rel)
            # Only resolve ordinary Markdown local-file links. No network, glob or code execution.
            for value in re.findall(r'(?<!!)\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)', masked):
                value = value.strip('<>')
                try:
                    parsed = urlsplit(value)
                except ValueError:
                    add('warning', 'unparsed_link', f'无法解析链接：{value}', rel)
                    continue
                if parsed.scheme or parsed.netloc:
                    continue
                if not parsed.path:
                    continue  # section anchors are outside this check's scope
                dest = Path(unquote(parsed.path))
                if dest.is_absolute() or re.match(r'^[A-Za-z]:', str(dest)):
                    add('warning', 'external_link', '绝对路径引用未读取，需人工核授权与位置', rel)
                    continue
                full = Path(os.path.abspath(path.parent / dest))
                if not full.is_relative_to(root) or _linked(full):
                    add('warning', 'external_link', '根外/链接引用未读取，需人工核授权与位置', rel)
                elif not full.is_file():
                    add('error', 'broken_link', f'本地文件链接不存在或非文件：{value}', rel)
    counts = {key: sum(item['severity'] == key for item in issues)
              for key in ('error', 'warning', 'not_applicable')}
    status = ('failed' if counts['error'] else 'not_applicable' if count == 0
              else 'manual_review' if manual else 'passed_with_warnings' if counts['warning'] else 'passed')
    return {'mode': mode, 'root': str(root), 'status': status, 'outlines': count,
            'counts': counts, 'issues': issues,
            'limits': '仅机械检查；未验证语义可写性、动机因果、证据真实性、实际授权或文学质量；不解析网络链接/节锚点/行内代码路径。'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path, help='已有作品根')
    parser.add_argument('--mode', choices=('format', 'readiness'), default='format')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    report = inspect(args.root, args.mode)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"章纲{args.mode}机械检查：{report['status']}，{report['outlines']}份")
        for issue in report['issues']:
            print(f"- {issue['severity']} {issue['path']}: {issue['message']}")
        print(report['limits'])
    return 1 if report['counts']['error'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
