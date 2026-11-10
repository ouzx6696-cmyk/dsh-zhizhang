"""离线语料标尺：只输出数字及指纹，不输出正文或雷达引文。"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

METRICS = Path(__file__).resolve().parents[1] / 'packages/fanqie/skill/scripts/reading_metrics.py'
spec = importlib.util.spec_from_file_location('reading_metrics', METRICS)
metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metrics)
LINTER = metrics.LINTER
chapter_metrics = metrics.chapter_metrics
distribution = metrics.distribution


def summarize(book, requested):
    chapters = [chapter_metrics(chapter) for chapter in book['chapters']]
    warned = sum(chapter['styleHits'] > 0 for chapter in chapters)
    return {
        **{key: book[key] for key in ('id', 'kind', 'sourceHash', 'availableChapters')},
        'sampleComplete': len(chapters) == requested and all(chapter['number'] == index+1 for index, chapter in enumerate(chapters)),
        'sampledChapters': len(chapters),
        'warnedChapters': warned, 'chapterWarningRate': round(warned/len(chapters), 4),
        'chapterLength': distribution([chapter['characters'] for chapter in chapters]),
        'styleDensity': distribution([chapter['styleHitsPer1000'] for chapter in chapters]),
        'chapters': chapters,
    }


def evaluate(books):
    groups = {}
    for kind in ('human', 'ai'):
        selected = [book for book in books if book['kind'] == kind]
        count = sum(book['sampledChapters'] for book in selected)
        warned = sum(book['warnedChapters'] for book in selected)
        groups[kind] = {'books': len(selected), 'chapters': count,
                        'chapterWarningRate': round(warned/count, 4) if count else None}
    human, ai = groups['human']['chapterWarningRate'], groups['ai']['chapterWarningRate']
    complete = all(book['sampleComplete'] for book in books)
    return {'groups': groups, 'samplesComplete': complete,
            'warningRateGap': round(ai-human, 4) if human is not None and ai is not None else None,
            'humanBelow10Percent': human < .1 if human is not None else None,
            'status': 'baseline-only' if human is not None and ai is not None and complete else 'insufficient-data',
            'note': '真书触发率是误报代理，不是逐条人工误报标注；差值不证明语义质量或已达到区分度。'}


def main():
    request = json.load(sys.stdin)
    books = [summarize(book, request['limit']) for book in request['books']]
    result = {'schemaVersion': 1, 'linterHash': hashlib.sha256(LINTER.read_bytes()).hexdigest(),
              'requestedChaptersPerBook': request['limit'],
              'measurement': {'characters': 'Unicode码点，去空白、章节标题、独立分隔行，含标点',
                              'paragraph': '非空物理行，短段<=30，长段>80/>120',
                              'dialogue': '现有雷达配对引号并集内非空字符（不含外层引号）/正文字数',
                              'percentile': '排序后线性插值', 'style': '现有scan_style，叙述命中；对白另计'},
              'books': books, 'evaluation': evaluate(books)}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
