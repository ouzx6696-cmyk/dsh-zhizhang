#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
番茄长篇规则桥（writer-agent · fanqie）。
把 inspiration-forge-suite 1.3.0 的原脚本包成统一 JSON 契约：
stdout 只输出一个 JSON 对象，含 tool / rules_version / ok。沿用上游方法入口；语感雷达与阅读统计包含本地扩展，改动由资产指纹追溯。

子命令：
  outline <input.json>                 章纲字段检查（长篇章纲 ↔ forge 章纲接口一一对应）
  ledger  <file> [<file> ...]          跨文档数字与时间对照（ledger_check.scan）+ 连续性候选（continuity_scan.scan）
  continuity <file> [<file> ...]       连续性候选抽取（物件/伤势/知情线索句；只抽取不判定）
  lint    <long_para> <file> [...]     正文体检（manuscript_linter.lint_file）
  style   <request.json>               文风命中坐标（manuscript_linter.scan_style；scan_style 与
                                       utf16_positions 是本仓在上游 forge 之外新增的，坐标按 UTF-16 计）
  scan    <file> <top> <keywords>      长篇测绘（novel_scanner.scan_novel）
  quote   <source> <analysis> <min>    引文核对（quote_check.check）
只用 Python 标准库；只读，不写任何文件。
"""
import io
import json
import re
import sys
from contextlib import redirect_stdout
from pathlib import Path

RULES_VERSION = 'forge-1.3.0'
HERE = Path(__file__).resolve().parent
FORGE = HERE.parent / 'forge'
for sub in ('inspiration-forge/scripts', 'novel-writer/scripts', 'inspiration-forge-library/scripts'):
    sys.path.insert(0, str(FORGE / sub))

import reading_metrics  # noqa: E402
import check_outline  # noqa: E402
import ledger_check  # noqa: E402
import manuscript_linter  # noqa: E402
import novel_scanner  # noqa: E402
import quote_check  # noqa: E402

# —— T10 连续性候选抽取（只抽取、不判定）：物件处置、伤势、知情越界线索句 ——
OBJECT_CUES = [
    '掏出', '递给', '塞给', '塞进', '扔掉', '丢进', '丢下', '藏进', '藏起', '藏在',
    '捡起', '收起', '收进', '放在', '掉在', '留在', '带走', '忘在', '攥着', '握着',
    '别在', '挎着', '背着', '摸出', '翻出',
]
INJURY_CUES = [
    '伤口', '伤势', '淤青', '骨折', '裂开', '绷带', '疤痕', '咳血', '呕血', '止血',
    '包扎', '旧伤', '内伤', '肿起', '瘸',
]
KNOWLEDGE_CUES = [
    '不知道', '不知情', '一无所知', '隐瞒', '秘密', '识破', '看穿', '摊牌', '说漏',
    '走漏', '早就知道', '才知道', '这才知道', '装作不知', '蒙在鼓里', '知情',
]
_CUE_KINDS = [
    ('物件', OBJECT_CUES),
    ('伤势', INJURY_CUES),
    ('知情', KNOWLEDGE_CUES),
]
_CONTEXT_MAX = 80


def continuity_candidates(text, file=''):
    """按行抽取候选：{file, line, kind, value, context}；每行每类至多一条。"""
    rows = []
    for no, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        for kind, cues in _CUE_KINDS:
            cue = next((c for c in cues if c in line), None)
            if cue is None:
                continue
            context = line.strip()
            if len(context) > _CONTEXT_MAX:
                context = context[:_CONTEXT_MAX] + '…'
            rows.append({'file': file, 'line': no, 'kind': kind, 'value': cue, 'context': context})
    return rows

# 长篇章纲字段 → forge 章纲接口（check_outline.BLOCKS / FIELDS）
FIELD_MAP = [
    ('synopsis', '剧情梗概'),
    ('conflict', '核心冲突与看点'),
    ('beats', '情节推进节点'),
    ('ending', '章末落点'),
    ('pov', '视角'),
    ('targetWords', '目标篇幅'),
    ('locks', '锁定事实'),
    ('knowledge', '人物知识边界'),
]
assert [f for _, f in FIELD_MAP] == list(check_outline.BLOCKS) + list(check_outline.FIELDS)


def out(obj, code=0):
    obj.setdefault('rules_version', RULES_VERSION)
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()
    sys.exit(code)


def fail(tool, code, message):
    out({'tool': tool, 'ok': False, 'code': code, 'message': message})


def cmd_outline(path):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    mode = data.get('mode', 'readiness')
    chapters = data.get('chapters') or []
    records = [{'id': str(chapter.get('id', '')), 'position': chapter.get('position', 0),
                'fields': {label: (chapter.get('outline') or {}).get(key) for key, label in FIELD_MAP}}
               for chapter in chapters]
    report = check_outline.inspect_records(records, mode)
    out({'tool': 'outline', 'ok': True, **report,
         'field_map': {k: v for k, v in FIELD_MAP},
         'note': '只查接口、空值与显式占位；不判断动机、因果、可写性或文学质量。'})


def _read_candidates(paths, tool):
    missing = [str(p) for p in paths if not p.is_file()]
    if missing:
        fail(tool, 'NOT_FOUND', '文件不存在：' + '、'.join(missing))
    rows = []
    for p in paths:
        for row in continuity_candidates(p.read_text(encoding='utf-8', errors='replace'), file=p.name):
            rows.append(row)
    return rows


def cmd_ledger(files):
    paths = [Path(f) for f in files]
    missing = [str(p) for p in paths if not p.is_file()]
    if missing:
        fail('ledger', 'NOT_FOUND', '文件不存在：' + '、'.join(missing))
    rows = []
    for p in paths:
        for row in ledger_check.scan(p, None):
            row['file'] = p.name  # 只留来源名，不暴露临时目录
            rows.append(row)
    out({'tool': 'ledger', 'ok': True, 'files': [p.name for p in paths], 'items': rows,
         'candidates': _read_candidates(paths, 'ledger'),
         'note': '只抽取、不判对错；数字不同也可能是剧情变化，candidates 是物件/伤势/知情线索句，由编辑对照上下文判断。'})


def cmd_continuity(files):
    paths = [Path(f) for f in files]
    out({'tool': 'continuity', 'ok': True, 'files': [p.name for p in paths],
         'candidates': _read_candidates(paths, 'continuity'),
         'note': '只抽取、不判定：物件处置/伤势/知情线索句，供连续性登记与巡检参考。'})


def cmd_lint(long_para, files):
    reports = []
    for f in files:
        r = manuscript_linter.lint_file(f, int(long_para))
        r['file'] = Path(f).name
        reports.append(r)
    out({'tool': 'lint', 'ok': True, 'reports': reports,
         'note': '命中只是值得回看的位置，不是错误判定；台词里的命中通常保留。'})


def cmd_style(file):
    request = json.loads(Path(file).read_text(encoding='utf-8'))
    result = manuscript_linter.scan_style(request['text'], request.get('limit'), request.get('ranges'), density_thresholds=request.get('densityThresholds'))
    out({'tool': 'style', 'ok': True, **result})


def cmd_scan(file, top, keywords):
    if not Path(file).is_file():
        fail('scan', 'NOT_FOUND', f'文件不存在：{file}')
    kws = [k.strip() for k in keywords.split(',') if k.strip()] if keywords else []
    buf = io.StringIO()
    with redirect_stdout(buf):
        res = novel_scanner.scan_novel(file, top_n_chapters=int(top), keywords=kws)
    res['file'] = Path(file).name
    out({'tool': 'scan', 'ok': True, **res, 'note': '章末标签来自词语规则，仅作定位提示。'})


def cmd_quote(source, analysis, min_chars):
    for p in (source, analysis):
        if not Path(p).is_file():
            fail('quote', 'NOT_FOUND', f'文件不存在：{p}')
    res = quote_check.check(source, analysis, int(min_chars))
    bad = [r for r in res if r['status'] != '逐字命中']
    out({'tool': 'quote', 'ok': True, 'checked': len(res), 'not_verbatim': len(bad),
         'pass': not bad, 'items': res, 'warnings': quote_check.normalization_warnings()})


def main(argv):
    if len(argv) < 2:
        fail('bridge', 'INVALID_ARGS', '缺少子命令')
    cmd, rest = argv[1], argv[2:]
    try:
        if cmd == 'outline' and len(rest) == 1:
            cmd_outline(rest[0])
        elif cmd == 'ledger' and rest:
            cmd_ledger(rest)
        elif cmd == 'continuity' and rest:
            cmd_continuity(rest)
        elif cmd == 'lint' and len(rest) >= 2:
            cmd_lint(rest[0], rest[1:])
        elif cmd == 'reading' and len(rest) == 1:
            request = json.loads(Path(rest[0]).read_text(encoding='utf-8'))
            out({'tool': 'reading', 'ok': True, 'chapters': [reading_metrics.chapter_metrics(chapter) for chapter in request['chapters']]})
        elif cmd == 'style' and len(rest) == 1:
            cmd_style(rest[0])
        elif cmd == 'scan' and len(rest) == 3:
            cmd_scan(*rest)
        elif cmd == 'quote' and len(rest) == 3:
            cmd_quote(*rest)
        else:
            fail(cmd, 'INVALID_ARGS', f'子命令或参数不对：{cmd} {rest}')
    except SystemExit:
        raise
    except Exception as exc:  # 脚本内部异常也走契约，绝不静默通过
        fail(cmd, 'SCRIPT_FAILED', f'{type(exc).__name__}: {exc}')


if __name__ == '__main__':
    main(sys.argv)
