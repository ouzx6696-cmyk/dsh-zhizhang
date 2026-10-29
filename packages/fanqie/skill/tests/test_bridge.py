#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fanqie_bridge 契约测试：每个子命令都只输出一个带 tool/rules_version/ok 的 JSON 对象。"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRIDGE = HERE.parent / 'scripts' / 'fanqie_bridge.py'
EX = HERE.parent / 'forge' / 'novel-writer' / 'assets' / 'examples' / '两张车票.md'
passed = failed = 0


def run(*args):
    p = subprocess.run([sys.executable, '-B', str(BRIDGE), *map(str, args)], capture_output=True, text=True, encoding='utf-8')
    obj = json.loads(p.stdout)
    assert {'tool', 'rules_version', 'ok'} <= obj.keys(), obj
    return obj


def case(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print('  ok  ', name)
    except Exception as e:  # noqa: BLE001
        failed += 1
        print('  FAIL', name, '<-', repr(e))


GOOD = {'pov': '林晚第三人称限知', 'targetWords': 2500, 'locks': '车票两张，一张是假的', 'knowledge': '林晚不知道哥哥已到站',
        'synopsis': '林晚在检票口发现票有问题', 'conflict': '检票员拦人，后面队伍催', 'beats': '发现—周旋—换票', 'ending': '哥哥的电话打进来'}


def t_outline_pass():
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'in.json'
        f.write_text(json.dumps({'mode': 'readiness', 'chapters': [
            {'id': 'c1', 'position': 1, 'outline': GOOD}, {'id': 'c2', 'position': 2, 'outline': GOOD}]}, ensure_ascii=False), encoding='utf-8')
        r = run('outline', f)
        assert r['ok'] and r['pass'] and r['errors'] == 0, r


def t_outline_fail():
    bad = dict(GOOD, synopsis='', conflict='【本章主要经历】', targetWords=0)
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'in.json'
        f.write_text(json.dumps({'chapters': [{'id': 'c1', 'position': 1, 'outline': GOOD}, {'id': 'c3', 'position': 3, 'outline': bad}]}, ensure_ascii=False), encoding='utf-8')
        r = run('outline', f)
        fields = {(i['chapter'], i['field']) for i in r['issues'] if i['level'] == 'error'}
        assert not r['pass'] and ('c3', '剧情梗概') in fields and ('c3', '核心冲突与看点') in fields and ('c3', '目标篇幅') in fields, r
        assert any(i['field'] == 'position' for i in r['issues']), '应提示缺第 2 章'


def t_outline_format_mode():
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'in.json'
        f.write_text(json.dumps({'mode': 'format', 'chapters': [{'id': 'c1', 'position': 1, 'outline': dict(GOOD, synopsis='')}]}, ensure_ascii=False), encoding='utf-8')
        assert run('outline', f)['pass'], 'format 模式不查空值'


def t_lint():
    r = run('lint', 160, EX)
    rep = r['reports'][0]
    assert r['ok'] and rep['total_chars'] > 500 and 'ai_cliches' in rep, rep.keys()


def t_lint_hits():
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'c.md'
        f.write_text('# 第一章\n\n他眼中闪过一丝寒光，嘴角勾起一抹冷笑。\n\n“不是我不想，而是不能。”她说。\n', encoding='utf-8')
        rep = run('lint', 160, f)['reports'][0]
        assert rep['ai_cliche_count'] >= 2 and rep['dialogue_hit_count'] >= 1, rep


def t_ledger():
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / 'C001-章纲.md', Path(d) / 'C001-正文.md'
        a.write_text('他欠了三百块，约定次日还。', encoding='utf-8')
        b.write_text('第二天他拿出两百块。', encoding='utf-8')
        r = run('ledger', a, b)
        assert r['ok'] and len(r['items']) >= 2 and r['files'] == ['C001-章纲.md', 'C001-正文.md'], r


def t_ledger_missing():
    r = run('ledger', '/nope/x.md')
    assert r['ok'] is False and r['code'] == 'NOT_FOUND'


def t_scan():
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'book.txt'
        f.write_text('第一章 开始\n林晚上了车。\n到底是谁？\n第二章 中途\n林晚下车，轰的一声。\n', encoding='utf-8')
        r = run('scan', f, 5, '林晚')
        assert r['ok'] and r['chapter_count'] == 2 and r['keyword_frequencies']['林晚'] == 2, r


def t_quote():
    with tempfile.TemporaryDirectory() as d:
        s, a = Path(d) / 'src.txt', Path(d) / 'ana.md'
        s.write_text('林晚把两张车票捏在手里，指节发白。\n', encoding='utf-8')
        a.write_text('开头写“林晚把两张车票捏在手里”，又写“她心里翻江倒海不能自已”。\n', encoding='utf-8')
        r = run('quote', s, a, 6)
        st = {i['status'] for i in r['items']}
        assert r['checked'] == 2 and r['not_verbatim'] == 1 and '逐字命中' in st and not r['pass'], r


def t_bad_cmd():
    r = run('nope')
    assert r['ok'] is False and r['code'] == 'INVALID_ARGS'


for n, f in list(globals().items()):
    if n.startswith('t_'):
        case(n[2:], f)
print(f'{passed}/{passed + failed} 通过')
sys.exit(1 if failed else 0)
