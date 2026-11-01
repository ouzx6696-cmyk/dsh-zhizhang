#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""发稿台账：outputs/toutiao/log.csv。只记立项字段，不存正文。

  python3 scripts/ledger.py add  --card 立项卡.json [--status 已验收] [--date 2026-10-28]
  python3 scripts/ledger.py status --title "主标题" --to 已交稿
  python3 scripts/ledger.py show [--last 10]

  --ledger 指定台账路径，默认 outputs/toutiao/log.csv（不存在会自动建）。
  qa_check.py --card 会读这份台账：资讯线查开头式/结尾式/人名撞车、同赛道同日、账本型占比；
  故事线查 30 天内同一故事或同一母题、连续两篇同一改编方式。
  4.0.0 新增 内容线、母题、故事、改编方式 四列。3.x 的旧台账照常读，下次写入时补齐表头，旧行的新列留空
  （内容线按主驱动推断：故事型算故事线，其余算资讯线）。
"""
import argparse, csv, datetime, json, os, sys, tempfile, time
from contextlib import contextmanager

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rules import LEDGER_FIELDS, GENRE_MODE, LINES, line_of  # noqa: E402

STATUSES = ["初稿待改", "待验收", "已验收", "验收退回", "已交稿"]


def read(path):
    if not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


@contextmanager
def locked(path):
    # OS locks are released on process exit, including cancellation/crashes.
    lock = os.path.realpath(path) + ".lock"
    os.makedirs(os.path.dirname(lock), exist_ok=True)
    fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
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
    fields = list(LEDGER_FIELDS)
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
                w.writerow(r)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def row_from_card(c, date, status):
    ln = line_of(c)
    return {"日期": date, "内容线": ln, "体裁": c.get("体裁", ""), "垂类": c.get("垂类", ""),
            "主驱动": c.get("主驱动") or LINES[ln]["default_driver"] or "",
            "母题": c.get("母题", "") if ln == "故事线" else "",
            "故事": c.get("故事", "") if ln == "故事线" else "",
            "改编方式": c.get("改编方式", "") if ln == "故事线" else "",
            "开头式": c.get("开头式", ""), "结尾式": c.get("结尾式", ""),
            "锚点人名": (c.get("锚点人物") or {}).get("名字", ""), "主标题": c.get("主标题", ""),
            "状态": status}


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
