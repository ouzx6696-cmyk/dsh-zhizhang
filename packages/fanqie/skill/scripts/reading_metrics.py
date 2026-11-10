"""正文量化口径；评测命令与桌面共用，只产出数值。"""
import importlib.util
from pathlib import Path
import re
import statistics
from collections import Counter

LINTER = Path(__file__).resolve().parents[1] / 'forge/novel-writer/scripts/manuscript_linter.py'
spec = importlib.util.spec_from_file_location('manuscript_linter', LINTER)
linter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(linter)

def distribution(values):
    ordered = sorted(values)
    def percentile(fraction):
        position = (len(ordered) - 1) * fraction
        lower = int(position)
        upper = min(lower + 1, len(ordered) - 1)
        return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower), 4)
    return {'mean': round(statistics.mean(values), 4), 'p10': percentile(.1),
            'p50': percentile(.5), 'p90': percentile(.9)}


def chapter_metrics(chapter):
    body = chapter['body']
    # 一行一段与空行分段的 TXT 都按非空物理行统计；仅去掉独立分隔行。
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    paragraphs = [line for line in lines if not re.fullmatch(r'[.。…·*＊_—\-=~～\s]{2,}', line)]
    if not paragraphs:
        raise ValueError(f"第{chapter['number']}章没有有效正文")
    text = '\n'.join(paragraphs)
    lengths = [len(re.sub(r'\s', '', paragraph)) for paragraph in paragraphs]
    characters = sum(lengths)
    scan = linter.scan_style(text)
    ranges = scan['dialogueRanges']
    encoded = text.encode('utf-16-le')
    dialogue = sum(len(re.sub(r'\s', '', encoded[start*2:end*2].decode('utf-16-le')))-2
                   for start, end in ranges)
    categories = Counter(hit['category'] for hit in scan['hits'])
    terms = {term: text.count(term) for term in ('一丝', '一抹', '几分', '些许', '然而', '与此同时')}
    return {
        'recapCharacters': lengths[0] if re.search(r'回顾|上一章|此前|回想起', paragraphs[0]) else 0,
        'number': chapter['number'], 'characters': characters, 'paragraphs': len(lengths),
        'paragraphLength': distribution(lengths), 'shortParagraphShare': sum(n <= 30 for n in lengths)/len(lengths),
        'paragraphsOver80': sum(n > 80 for n in lengths), 'paragraphsOver120': sum(n > 120 for n in lengths),
        'dialogueShare': round(dialogue/characters, 4), 'endingCharacters': lengths[-1],
        'separatorLinesExcluded': len(lines)-len(paragraphs), 'styleHits': scan['totalHits'],
        'dialogueHits': len(scan['dialogueHits']), 'styleCategories': dict(categories),
        'styleHitsPer1000': round(scan['totalHits'] * 1000/characters, 4),
        'termCounts': terms, 'termDensityPer10000': {term: round(count*10000/characters, 4) for term, count in terms.items()},
    }
