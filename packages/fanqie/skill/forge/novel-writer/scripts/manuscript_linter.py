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
from bisect import bisect_left, bisect_right
import argparse
import json
import math
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

PRIMARY_RULES = [{'category': 'cliche_syntax',
  'pattern': '不是[^。！？\\n]{0,48}而是',
  'hint': '辩证翻案套话：可改为具体动作或判断，不必先否定再立论。',
  'label': '辩证翻案套话'},
 {'category': 'cliche_syntax',
  'pattern': '与其说(?:是)?[^。！？\\n]{0,40}不如说(?:是)?',
  'hint': '修辞翻案套话：直接写处境下的判断即可。',
  'label': '辩证翻案套话'},
 {'category': 'cliche_syntax', 'pattern': '嘴角勾起一抹', 'hint': '脸谱微表情：用手头小动作、停顿或视线回避代替。', 'label': '五官情绪套话'},
 {'category': 'cliche_syntax', 'pattern': '眼中闪过一丝', 'hint': '廉价眼神描写：改写为可观察的具体反应。', 'label': '五官情绪套话'},
 {'category': 'cliche_syntax',
  'pattern': '(?:一丝|一抹|几分|些许)(?:[^。！？\\n]{0,8})?(?:不禁|不由得)?',
  'hint': '高频虚词堆砌：删去「一丝/一抹」等填充，保留可感细节。',
  'label': '高频AI虚词泛滥'},
 {'category': 'cliche_syntax', 'pattern': '不禁|不由得', 'hint': '被动情绪套话：改为角色主动的小动作或算计。', 'label': '高频AI虚词泛滥'},
 {'category': 'lazy_emotion',
  'pattern': '(?:他|她|我|他们|她们)(?:感到|觉得|意识到|注意到)[^。！？\\n]{0,40}',
  'hint': '感知前置：去掉「感到/意识到」，用处境偏见或具体代价呈现。',
  'label': '抽象情绪直判/认知前置'},
 {'category': 'lazy_emotion',
  'pattern': '心中涌起(?:一股)?[^。！？\\n]{0,20}',
  'hint': '抽象情绪宣判：改写为正在算计/逃避的具体动作。',
  'label': '抽象情绪直判/认知前置'},
 {'category': 'lazy_emotion',
  'pattern': '心情无比复杂|感到一阵莫名的|一阵莫名的',
  'hint': '空泛情绪标签：落到物件、声音或利益阻力上。',
  'label': '抽象情绪直判/认知前置'},
 {'category': 'process_skip',
  'pattern': '经过一番(?:激烈的)?心理斗争|经过一番交涉|很快便处理妥当|做出了艰难的抉择',
  'hint': '过程跳步：补写动作阻力、物件细节或带潜台词的交锋。',
  'label': '过程跳步偷懒'},
 {'category': 'slogan_ending',
  'pattern': '他知道[，,]属于他的[^。！？\\n]{0,30}才刚刚开始|暴风雨即将?来临|命运的齿轮开始转动|一切才刚刚开始',
  'hint': '章末口号癖：让结尾落在现场具体的人、事、声音或当场细节上。',
  'endingOnly': True,
  'label': '章末口号/拔高'}]


CATEGORY_CODES = {
    '辩证翻案套话': 'cliche_syntax', '五官情绪套话': 'cliche_syntax',
    '抽象情绪直判/认知前置': 'lazy_emotion', '高频AI虚词泛滥': 'cliche_syntax',
    '过程跳步偷懒': 'process_skip', '自我限定/解释过密': 'self_qualification',
    '章末口号/拔高': 'slogan_ending',
}
RULES = [(rule, re.compile(rule['pattern']), True) for rule in PRIMARY_RULES]
for label, patterns in AI_PATTERNS.items():
    for pattern in patterns:
        # The file linter historically matched one line at a time.
        pattern = re.sub(r'\[\^([^]]*)\]', lambda match: '[^' + match[1] + (r'\n' if r'\n' not in match[1] else '') + ']', pattern)
        rule = {'category': CATEGORY_CODES[label], 'label': label, 'pattern': pattern,
                'hint': label + '：命中仅作回看提示，结合人物声音与场面作用判断。'}
        RULES.append((rule, re.compile(pattern), False))


def utf16_positions(text):
    positions = [0]
    for character in text:
        positions.append(positions[-1] + (2 if ord(character) > 0xffff else 1))
    return positions


def dialogue_ranges(text, positions):
    stack, ranges = [], []
    for index, character in enumerate(text):
        if character == '"':
            if stack and stack[-1][0] == '"':
                _, start = stack.pop()
                ranges.append([positions[start], positions[index + 1]])
            else:
                stack.append((character, index))
        elif character in ('“', '「'):
            stack.append((character, index))
        elif character in ('”', '」') and stack:
            if stack[-1][0] == ('“' if character == '”' else '「'):
                _, start = stack.pop()
                ranges.append([positions[start], positions[index + 1]])
    merged = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def body_lines(text):
    title, body, offset = '', [], 0
    for number, line in enumerate(text.splitlines(keepends=True), 1):
        content = line.strip()
        if content:
            if not title and (content.startswith('#') or re.match(r'^第[零一二三四五六七八九十百千万0-9]+[章节]', content)):
                title = content.lstrip('#').strip()
            else:
                body.append((number, content, offset + len(line) - len(line.lstrip())))
        offset += len(line)
    return title, body


def statistics(text, long_para):
    title, body = body_lines(text)
    joined = ''.join(line for _, line, _ in body)
    chars, paragraphs = len(re.sub(r'\s+', '', joined)), len(body)
    short = sum(len(line) <= 12 for _, line, _ in body)
    return {
        'title': title or '(未检测到首行标题)', 'total_chars': chars,
        'cjk_chars': len(re.findall(r'[\u4e00-\u9fff]', joined)), 'para_count': paragraphs,
        'avg_para_chars': round(chars / paragraphs, 1) if paragraphs else 0,
        'short_para_ratio_pct': round(short / paragraphs * 100, 1) if paragraphs else 0,
        'overlong_paragraphs': [(number, len(line), line[:40] + '...') for number, line, _ in body if len(line) > long_para],
        'long_para_threshold': long_para, 'ending_preview': [line for _, line, _ in body[-2:]],
    }


def scan_style(text, limit=None, allowed_ranges=None, long_para=160, density_thresholds=None):
    if not isinstance(text, str) or (limit is not None and (not isinstance(limit, int) or limit < 0)):
        raise ValueError('invalid style input')
    if density_thresholds is not None:
        if not isinstance(density_thresholds, dict) or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in density_thresholds.values()):
            raise ValueError('invalid density thresholds')
    chars = max(1, len(re.sub(r'\s', '', text)))
    density = {term: text.count(term) * 10000 / chars for term in ('一丝', '一抹', '几分', '些许', '然而', '与此同时')}
    positions = utf16_positions(text)
    quotes = dialogue_ranges(text, positions)
    quote_starts = [start for start, _ in quotes]
    allowed_starts = []
    if allowed_ranges is not None:
        previous = -1
        for span in allowed_ranges:
            if not isinstance(span, dict) or not isinstance(span.get('start'), int) or not isinstance(span.get('end'), int) or not 0 <= span['start'] <= span['end'] <= positions[-1] or span['start'] < previous:
                raise ValueError('invalid style ranges')
            allowed_starts.append(span['start'])
            previous = span['end']
    def eligible(start, end):
        if allowed_ranges is None:
            return True
        index = bisect_right(allowed_starts, start) - 1
        if index < 0 or end > allowed_ranges[index]['end']:
            return False
        quote = bisect_left(quote_starts, end) - 1
        return quote < 0 or quotes[quote][1] <= start
    last = next(((match.start(), match.group()) for match in reversed(list(re.finditer(r'[^\n]+', text))) if match.group().strip()), (0, ''))
    primary, legacy = [], []
    for order, (rule, pattern, is_primary) in enumerate(RULES):
        offset, part = last if rule.get('endingOnly') else (0, text)
        for match in pattern.finditer(part):
            if density_thresholds is not None:
                if rule['pattern'] == PRIMARY_RULES[6]['pattern']:
                    continue  # 感知前置在对标密度模式只作描述，不因单次出现警告。
                term = next((word for word in density if match.group().startswith(word)), None)
                if term in density_thresholds and density[term] <= density_thresholds[term]:
                    continue
            start, end = positions[offset + match.start()], positions[offset + match.end()]
            if eligible(start, end):
                hit = {'category': rule['category'], 'start': start, 'end': end,
                       'match': match.group(), 'hint': rule['hint'], 'label': rule['label']}
                (primary if is_primary else legacy).append((start, end, order, hit))
    # Compare spans, never substring text elsewhere in the manuscript.
    occupied = {}
    for start, end, _, hit in primary:
        occupied.setdefault(hit['category'], []).append((start, end))
    intervals = {}
    for category, spans in occupied.items():
        ends, maximum = [], 0
        for _, end in sorted(spans):
            maximum = max(maximum, end)
            ends.append(maximum)
        intervals[category] = ([start for start, _ in sorted(spans)], ends)
    combined = list(primary)
    for start, end, order, hit in legacy:
        starts, ends = intervals.get(hit['category'], ([], []))
        index = bisect_left(starts, end) - 1
        if index < 0 or ends[index] <= start:
            combined.append((start, end, order, hit))
    narrative, spoken, seen = [], [], set()
    for start, end, _, hit in sorted(combined, key=lambda item: item[:3]):
        key = (start, end, hit['category'])
        if key in seen:
            continue
        seen.add(key)
        quote = bisect_right(quote_starts, start) - 1
        (spoken if quote >= 0 and start < quotes[quote][1] else narrative).append(hit)
    return {'hits': narrative if limit is None else narrative[:limit], 'totalHits': len(narrative),
            'dialogueRanges': quotes, 'dialogueHits': spoken if limit is None else spoken[:limit],
            'statistics': {**statistics(text, long_para), 'term_density_per10000': density, 'perception_count': len(re.findall(PRIMARY_RULES[6]['pattern'], text))}}


def lint_file(file_path, long_para=160):
    with open(file_path, 'r', encoding='utf-8') as file:
        text = file.read()
    _, body = body_lines(text)
    positions = utf16_positions(text)
    ranges = [{'start': positions[offset], 'end': positions[offset + len(line)]} for _, line, offset in body]
    # Keep dialogue receipts for the file report; only narrative hits are warnings.
    result = scan_style(text, long_para=long_para)
    starts = [positions[offset] for _, _, offset in body]
    def receipts(hits):
        output = []
        for hit in hits:
            index = bisect_right(starts, hit['start']) - 1
            if index < 0 or hit['end'] > ranges[index]['end']:
                continue
            number, line, _ = body[index]
            output.append({'line': number, 'category': hit['label'], 'matched': hit['match'],
                           'context': line[:90] + ('...' if len(line) > 90 else '')})
        return output
    ai_hits, spoken = receipts(result['hits']), receipts(result['dialogueHits'])
    return {'file': os.path.basename(file_path), **result['statistics'],
            'ai_cliche_count': len(ai_hits), 'ai_cliches': ai_hits,
            'dialogue_hit_count': len(spoken), 'dialogue_hits': spoken}

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
