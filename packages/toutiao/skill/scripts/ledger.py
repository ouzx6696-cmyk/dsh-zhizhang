#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""发稿台账：outputs/toutiao/log.csv。只记立项字段，不存正文。

  python3 scripts/ledger.py add  --card 立项卡.json [--status 已验收] [--date 2026-10-28]
  python3 scripts/ledger.py status --title "主标题" --to 已交稿
  python3 scripts/ledger.py show [--last 10]

  --ledger 指定台账路径，默认 outputs/toutiao/log.csv（不存在会自动建）。
  qa_check.py --card 会读这份台账：资讯线查开头式/结尾式/人名撞车、同赛道同日、账本型占比；
  故事线查 30 天内同一故事或同一母题、连续两篇同一改编方式；另与台账近 10 篇可比稿件做同质化机械比较。
  4.0.0 新增 内容线、母体、母题、故事、改编方式 列与平台回流列（链接/数据日期/展现/阅读/完读率/
  平均时长/评论/转发/涨粉）。3.x 的旧台账照常读，下次写入时补齐表头，旧行的新列留空
  （内容线按主驱动推断：故事型算故事线，其余算资讯线）。平台回流由 writer_bridge metrics-import
  写入：一篇文章一行，整批取数据日期最新的一天做快照，不按日拆行，存量数据不迁移。
"""
import argparse, csv, datetime, json, os, re, sys, tempfile, time
from contextlib import contextmanager

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rules import LEDGER_FIELDS, LEDGER_METRIC_FIELDS, GENRE_MODE, LINES, line_of  # noqa: E402

STATUSES = ["初稿待改", "待验收", "已验收", "验收退回", "已交稿"]


# 以 = + - @ 制表符或回车开头的单元格在 Excel/WPS 里可能被当公式执行（CSV 注入）。
# 写入时前置一个 '，读取时去掉一个；本来就以 ' 加这些字符开头的值也多垫一个，读写往返不丢字。
# 纯数字（含负数、百分比）不是公式，原样写，表格里仍按数字处理。
_FORMULA = re.compile(r"'*[=+\-@\t\r]")
_ESCAPED = re.compile(r"'+[=+\-@\t\r]")
_NUMBER = re.compile(r"[+-]?\d+(\.\d+)?%?")


def escape_cell(value):
    if isinstance(value, str) and _FORMULA.match(value) and not _NUMBER.fullmatch(value):
        return "'" + value
    return value


def unescape_cell(value):
    if isinstance(value, str) and _ESCAPED.match(value):
        return value[1:]
    return value


def read(path):
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8-sig", newline="") as f:
            return [{k: unescape_cell(v) for k, v in row.items()} for row in csv.DictReader(f)]
    except UnicodeDecodeError as error:
        raise ValueError(f"台账 {path} 不是 UTF-8 编码，请用 UTF-8 另存后重试") from error


@contextmanager
def locked(path):
    # OS locks are released on process exit, including cancellation/crashes.
    lock = os.path.realpath(path) + ".lock"
    os.makedirs(os.path.dirname(lock), exist_ok=True)
    deadline = time.monotonic() + 10
    while True:
        try:
            # Concurrent first-time creation of the same lock file can fail
            # transiently with EACCES on Windows; retry within the deadline.
            fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
            break
        except PermissionError:
            if time.monotonic() >= deadline:
                raise RuntimeError("台账被其他进程占用，请稍后重试：" + lock)
            time.sleep(0.05)
    try:
        if os.fstat(fd).st_size == 0:
            os.write(fd, b"\0")
        deadline = time.monotonic() + 10
        while True:
            try:
                if os.name == "nt":
                    import msvcrt
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("台账被其他进程占用，请稍后重试：" + lock)
                time.sleep(0.05)
        yield
    finally:
        os.close(fd)


def write(path, rows):
    folder = os.path.dirname(os.path.abspath(path))
    os.makedirs(folder, exist_ok=True)
    # 表头永远补齐到现行全部列：旧台账缺的列（内容线、母体、平台回流列）写入时一并补上，旧行留空
    fields = list(LEDGER_FIELDS) + list(LEDGER_METRIC_FIELDS)
    if any(r.get("文章ID") for r in rows):
        fields.append("文章ID")
    fd, temporary = tempfile.mkstemp(prefix=".ledger-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", restval="")
            w.writeheader()
            for r in rows:
                r = dict(r)
                if not r.get("内容线"):
                    r["内容线"] = line_of(r)
                w.writerow({k: escape_cell(v) for k, v in r.items()})
            f.flush()
            os.fsync(f.fileno())
        deadline = time.monotonic() + 5
        while True:
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                # Windows can briefly deny the rename while a reader or indexer
                # still holds log.csv open; the lock keeps writers serialized.
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.02)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def row_from_card(c, date, status):
    ln = line_of(c)
    return {"日期": date, "内容线": ln, "体裁": c.get("体裁", ""), "垂类": c.get("垂类", ""),
            "主驱动": c.get("主驱动") or LINES[ln]["default_driver"] or "",
            "母题": c.get("母题", "") if ln == "故事线" else "",
            "母体": c.get("母体", ""),
            "故事": c.get("故事", "") if ln == "故事线" else "",
            "改编方式": c.get("改编方式", "") if ln == "故事线" else "",
            "开头式": c.get("开头式", ""), "结尾式": c.get("结尾式", ""),
            "锚点人名": (c.get("锚点人物") or {}).get("名字", ""), "主标题": c.get("主标题", ""),
            "状态": status}


METRIC_SNAPSHOT_FIELDS = LEDGER_METRIC_FIELDS[2:]   # 展现/阅读/完读率/平均时长/评论/转发/涨粉


def merge_metrics(rows, article_id, url, entries):
    """把平台回流数据并进该文章的台账行：整批取数据日期最新的一天做快照，整行替换数值列。
    台账已有更新的快照时不覆盖（返回 kept）；一篇文章一行，不按日拆行。返回 (row, kept)。"""
    hits = [r for r in rows if r.get("文章ID") == article_id]
    if not hits and url:
        hits = [r for r in rows if r.get("链接") == url]
    if not hits:
        raise LookupError(f"台账里没有文章 {article_id}（先 toutiao_ledger_add 记账）")
    row = hits[-1]
    latest = max(entries, key=lambda e: str(e.get("日期") or ""))
    stored = (row.get("数据日期") or "").strip()
    if stored and stored > str(latest.get("日期") or ""):
        return row, True
    if url:
        row["链接"] = url
    row["数据日期"] = str(latest.get("日期") or "")
    for field in METRIC_SNAPSHOT_FIELDS:
        value = str(latest.get(field) or "").strip()
        row[field] = value
    return row, False


def performance_groups(rows):
    """同垂类同母体的历史表现：只统计回流过的行。样本 <10 篇只展示不计推荐。"""
    groups = {}
    for r in rows:
        if not ((r.get("展现") or "").strip() or (r.get("阅读") or "").strip()):
            continue
        key = ((r.get("垂类") or "").strip(), (r.get("母体") or "").strip())
        groups.setdefault(key, []).append(r)
    out = []
    for (vertical, matrix), items in groups.items():
        n = len(items)
        entry = {"垂类": vertical, "母体": matrix, "samples": n,
                 "articles": [{"日期": r.get("日期", ""), "主标题": r.get("主标题", ""),
                               "数据日期": r.get("数据日期", ""), "展现": r.get("展现", ""),
                               "阅读": r.get("阅读", ""), "完读率": r.get("完读率", ""),
                               "涨粉": r.get("涨粉", "")} for r in items[-10:]]}
        if n >= 10:
            shown = [_int_or_none(r.get("展现")) for r in items]
            reads = [_int_or_none(r.get("阅读")) for r in items]
            imp = [v for v in shown if v is not None]
            rd = [v for v in reads if v is not None]
            entry["基准"] = (f"同垂类同母体已回流 {n} 篇：平均展现 "
                            f"{round(sum(imp) / len(imp)) if imp else '—'} · 平均阅读 "
                            f"{round(sum(rd) / len(rd)) if rd else '—'}，新篇以此为基准")
        else:
            entry["备注"] = f"样本 {n} 篇（<10），只展示不计推荐"
        out.append(entry)
    return out


def _int_or_none(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def main_unlocked():
    ap = argparse.ArgumentParser(description="发稿台账")
    ap.add_argument("cmd", choices=["add", "status", "show"])
    ap.add_argument("--ledger", default="outputs/toutiao/log.csv")
    ap.add_argument("--card")
    ap.add_argument("--status", default="已验收", choices=STATUSES)
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--title")
    ap.add_argument("--to", choices=STATUSES)
    ap.add_argument("--last", type=int, default=10)
    a = ap.parse_args()
    rows = read(a.ledger)

    if a.cmd == "add":
        if not a.card:
            ap.error("add 需要 --card")
        c = json.load(open(a.card, encoding="utf-8"))
        if c.get("体裁") not in GENRE_MODE:
            sys.exit("立项卡体裁应为 长图文/短图文/微头条")
        if c.get("内容线") and c.get("内容线") not in LINES:
            sys.exit(f"立项卡内容线应为 {'/'.join(LINES)}")
        row = row_from_card(c, a.date, a.status)
        rows.append(row)
        write(a.ledger, rows)
        print(f"已记一行：{row['日期']} {row['内容线']} {row['体裁']} {row['主标题']}（{row['状态']}）")
    elif a.cmd == "status":
        if not (a.title and a.to):
            ap.error("status 需要 --title 和 --to")
        hit = [r for r in rows if r.get("主标题") == a.title]
        if not hit:
            sys.exit(f"台账里没有“{a.title}”")
        hit[-1]["状态"] = a.to
        write(a.ledger, rows)
        print(f"“{a.title}”→ {a.to}")
    else:
        for r in rows[-a.last:]:
            r = dict(r, 内容线=r.get("内容线") or line_of(r))
            print(" | ".join(r.get(k) or "" for k in LEDGER_FIELDS))
        if not rows:
            print("台账为空")


if __name__ == "__main__":
    ledger = sys.argv[sys.argv.index("--ledger") + 1] if "--ledger" in sys.argv else "outputs/toutiao/log.csv"
    with locked(ledger):
        main_unlocked()
