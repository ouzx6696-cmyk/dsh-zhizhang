#!/usr/bin/env python3
"""标点机械修正（toutiao-viral-writer 4.1.0）。

只改能机械判断、不改变意思的标点，改不准的只报告不动手：
  直角引号「」『』 → “ ”‘ ’；夹在中文里的英文直引号 → 成对的“ ”；
  贴着中文的半角 , ; : ? ! ( ) 和句末 . → 全角；单个“…”、...、。。 → ……；单个“—”、-- → ——；
  数字之间的 ~ 或 ～ → 到；去掉 Markdown 加粗 ** __ 和删除线 ~~。
不动：装饰符号（·★→ 等，要换成文字，得人来改）、行首 # 标题、图片行、代码。

用法：
  python3 scripts/fix_punct.py 终稿.md               # 写到 终稿.fixed.md，原稿不动
  python3 scripts/fix_punct.py 终稿.md --inplace     # 直接改原稿（先备份 终稿.md.bak）
  python3 scripts/fix_punct.py 终稿.md --check       # 只报告会改几处，不写文件；有可改项退出码 1
改完照常跑 qa_check.py；本脚本不打分。只依赖 Python 3 标准库。
"""
import argparse, os, re, shutil, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rules import CJK, IMG_RE, VERSION   # noqa: E402

HALF_FULL = {",": "，", ";": "；", ":": "：", "?": "？", "!": "！", "(": "（", ")": "）"}


def _pair_quotes(s, q, left, right):
    """把一行里的直引号按出现顺序配成左右引号；只处理贴着中文的那些。"""
    pairs = list(re.finditer(re.escape(q) + r"([^\n" + re.escape(q) + r"]*)" + re.escape(q), s))
    for match in reversed(pairs):
        if re.search(f"[{CJK}]", match.group(1)):
            s = s[:match.start()] + left + match.group(1) + right + s[match.end():]
    return s


def _fix_prose(s):
    """返回 (新行, [(类别, 次数)])。"""
    st = s.strip()
    if not st or IMG_RE.match(st) or st.startswith("```"):
        return s, []
    log = []

    def sub(pat, repl, label, text, flags=0):
        new, n = re.subn(pat, repl, text, flags=flags)
        if n:
            log.append((label, n))
        return new

    head = ""
    m = re.match(r"^(#{1,6}\s+)", s)
    if m:                                   # 标题标记保留，只修后面的字
        head, s = m.group(1), s[m.end():]
    s = sub(r"\*\*|__|~~", "", "Markdown 加粗/删除线", s)
    s = sub(r"「", "“", "直角引号", s)
    s = sub(r"」", "”", "直角引号", s)
    s = sub(r"『", "‘", "直角引号", s)
    s = sub(r"』", "’", "直角引号", s)
    before = s
    s = _pair_quotes(s, '"', "“", "”")
    if s != before:
        log.append(("英文直引号", sum(1 for a, b in zip(before, s) if a != b)))
    s = sub(rf"(?<=\d)\s*[~～]\s*(?=\d)", "到", "波浪号（数字范围）", s)
    s = sub(r"\.{3,}|。{2,}|(?<!…)…(?!…)", "……", "省略号", s)
    s = sub(r"(?<![-—])--+(?![-—])|(?<!—)—(?!—)", "——", "破折号", s)
    s = sub(rf"(?<=[{CJK}])\.(?=[”’]|\s|$)", "。", "半角句号", s)
    for h, f in HALF_FULL.items():
        e = re.escape(h)
        s = sub(rf"(?<=[{CJK}“”‘’（）])\s*{e}|{e}\s*(?=[{CJK}“”‘’])", f, "半角标点", s)
    return head + s, log


# URLs, Markdown links and inline code are source material, not prose punctuation.
PROTECTED = re.compile(r"`+[^`]*`+|!?\[[^\]\n]*\]\([^\s)]*\)|https?://[^\s<>]+")


def fix_line(s):
    if IMG_RE.match(s.strip()) or s.strip().startswith("【配图："):
        return s, []
    out, log, pos = [], [], 0
    for match in PROTECTED.finditer(s):
        fixed, changes = _fix_prose(s[pos:match.start()])
        out.extend((fixed, match.group()))
        log.extend(changes)
        pos = match.end()
    fixed, changes = _fix_prose(s[pos:])
    return "".join(out) + fixed, log + changes


def main():
    ap = argparse.ArgumentParser(description="头条稿件标点机械修正")
    ap.add_argument("file")
    modes = ap.add_mutually_exclusive_group()
    modes.add_argument("--inplace", action="store_true", help="直接改原稿，先备份为 .bak")
    modes.add_argument("--check", action="store_true", help="只报告，不写文件")
    ap.add_argument("--version", action="version", version=VERSION)
    a = ap.parse_args()
    try:
        lines = open(a.file, encoding="utf-8").read().split("\n")
    except OSError as e:
        print(f"读不到稿件：{e}")
        sys.exit(2)
    total, stats, out, fence = 0, {}, [], None
    for ln in lines:
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", ln)
        if marker:
            token, tail = marker.groups()
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence) and not tail.strip():
                fence = None
            out.append(ln)
            continue
        if fence:
            out.append(ln)
            continue
        new, log = fix_line(ln)
        for k, n in log:
            stats[k] = stats.get(k, 0) + n
            total += n
        out.append(new)
    left = []
    text = "\n".join(out)
    for pat, label in [(r"[·•●○■□▲△★☆◆◇→←↑↓√×※✓✔❌⭐️✨]", "装饰符号"), (r"[~～]", "波浪号（非数字范围）"),
                       (r"(?<!#)#(?!#)", "单个 #")]:
        n = len(re.findall(pat, re.sub(r"^#{1,6}\s+", "", text, flags=re.M)))
        if n:
            left.append(f"{label} {n} 处")
    print(f"标点修正 v{VERSION}：可机械修正 {total} 处" + ("（" + "、".join(f"{k} {n}" for k, n in stats.items()) + "）" if stats else ""))
    if left:
        print("需要人工改：" + "、".join(left) + "（换成文字或“到”“至”）")
    if a.check:
        sys.exit(1 if total else 0)
    if not total:
        print("没有要改的，原稿不动")
        sys.exit(0)
    if a.inplace:
        try:
            with open(a.file + ".bak", "xb") as backup, open(a.file, "rb") as original:
                shutil.copyfileobj(original, backup)
        except FileExistsError:
            ap.error("备份 .bak 已存在，请先另存备份；原稿未改")
        dst = a.file
    else:
        root, ext = os.path.splitext(a.file)
        dst = f"{root}.fixed{ext or '.md'}"
    try:
        with open(dst, "w" if a.inplace else "x", encoding="utf-8") as output:
            output.write(text)
    except FileExistsError:
        ap.error("修正稿已存在，请先另存；原稿未改")
    print(f"已写入 {dst}；接着跑 qa_check.py 复检")


if __name__ == "__main__":
    main()
