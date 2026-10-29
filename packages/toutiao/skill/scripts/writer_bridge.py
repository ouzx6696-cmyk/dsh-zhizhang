#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""writer-agent 插件与头条规则脚本之间的桥。只依赖 Python 3 标准库。

所有子命令向 stdout 输出且只输出一个 JSON 对象（dev-plan §5.1 契约）：

    {"tool": ..., "rules_version": ..., "ok": bool, ...子命令字段..., "raw": ...}

规则本身仍只在 rules.py / qa_check.py / ledger.py / fetch_hot.py 里，本文件不复制任何规则。

    python3 writer_bridge.py qa --file 稿.md [--card 立项卡.json] [--ledger log.csv] [--mode long]
    python3 writer_bridge.py rules
    python3 writer_bridge.py limits
    python3 writer_bridge.py hot [--top 30] [--vertical 综合] [--relevant]
    python3 writer_bridge.py ledger-add --card 立项卡.json --ledger log.csv [--status 已验收] [--date 2026-10-28]
    python3 writer_bridge.py ledger-status --title 主标题 --to 已交稿 --ledger log.csv
    python3 writer_bridge.py ledger-show --ledger log.csv [--last 10]
"""
import argparse, io, json, os, subprocess, sys, tempfile, contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rules as R  # noqa: E402
import ledger as L  # noqa: E402

TITLE_MAX = 34  # qa_check.py 的硬闸值（“标题超34字”）；保持一致，见 qa_check.py title_too_long


def emit(tool, ok, **fields):
    out = {"tool": tool, "rules_version": R.VERSION, "ok": ok}
    out.update(fields)
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def run_script(args, timeout):
    """运行同目录脚本，返回 (exit_code, stdout, stderr)。"""
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    p = subprocess.run([sys.executable] + args, cwd=HERE, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=timeout, env=env)
    return p.returncode, p.stdout, p.stderr


def cmd_qa(a):
    args = [os.path.join(HERE, "qa_check.py"), a.file, "--json", "--ledger", a.ledger or os.devnull]
    if a.card:
        args += ["--card", a.card]
    if a.mode:
        args += ["--mode", a.mode]
    if a.title:
        args += ["--title", a.title]
    code, out, err = run_script(args, 120)
    if code == 2 or not out.strip().startswith("{"):
        # 2 = 读不到稿件/立项卡/缺标题：业务输入错误，不是“打回”
        emit("qa", False, code="INVALID_INPUT", message=(out.strip() or err.strip())[:800], raw=out + err)
        return 0
    r = json.loads(out)
    fails = [{"code": "ITEM_" + i["key"].upper(), "message": i["note"], "score": i["score"]}
             for i in r.get("items", []) if i.get("status") == "fail"]
    card_fail = [{"code": "CARD", "message": m} for lv, m in r.get("card_checks", []) if lv == "fail"]
    card_warn = [m for lv, m in r.get("card_checks", []) if lv != "fail"]
    emit("qa", True,
         score=r["overall"], **{"pass": bool(r["passed"])},
         fails=fails + card_fail,
         warnings=list(r.get("risk_flags", [])) + list(r.get("hints", [])) + card_warn,
         hard_gates=list(r.get("hard_gates", [])),
         verdict=r.get("verdict", ""), title=r.get("title", ""), title_len=r.get("title_len", 0),
         chars=r.get("chars", 0), report=r, raw=out)
    return 0


def cmd_rules(a):
    code, out, err = run_script([os.path.join(HERE, "qa_check.py"), "--rules"], 30)
    emit("rules", code == 0, markdown=out, raw=err)
    return 0


def cmd_limits(a):
    emit("limits", True, title_max=TITLE_MAX, bands=R.BANDS, genres=list(R.GENRE_MODE.keys()),
         lines=list(R.LINES.keys()), drivers=list(R.DRIVERS.keys()), statuses=L.STATUSES,
         ledger_fields=R.LEDGER_FIELDS)
    return 0


def cmd_hot(a):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "hot.json")
        args = [os.path.join(HERE, "fetch_hot.py"), "--top", str(a.top), "--vertical", a.vertical, "--json", path]
        if a.relevant:
            args.append("--relevant")
        try:
            code, out, err = run_script(args, 110)
        except subprocess.TimeoutExpired:
            emit("hot", False, code="TIMEOUT", message="抓榜超时；改用网页搜索，再不行请作者粘贴热榜", raw="")
            return 0
        if code != 0 or not os.path.isfile(path):
            emit("hot", False, code="FETCH_FAILED",
                 message="热榜抓取失败（退出码 %d）；改用网页搜索，再不行请作者粘贴热榜" % code, raw=out + err)
            return 0
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    emit("hot", True, items=data, raw=out)
    return 0


def _capture(fn):
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            fn()
        return True, buf.getvalue()
    except SystemExit as e:
        msg = buf.getvalue() + (e.code if isinstance(e.code, str) else "")
        return (e.code in (0, None)), msg


def cmd_ledger_add(a):
    with open(a.card, encoding="utf-8") as f:
        c = json.load(f)
    if c.get("体裁") not in R.GENRE_MODE:
        emit("ledger-add", False, code="INVALID_INPUT", message="立项卡体裁应为 长图文/短图文/微头条", raw="")
        return 0
    if c.get("内容线") and c.get("内容线") not in R.LINES:
        emit("ledger-add", False, code="INVALID_INPUT", message="立项卡内容线应为 " + "/".join(R.LINES), raw="")
        return 0
    rows = L.read(a.ledger)
    row = L.row_from_card(c, a.date, a.status)
    rows.append(row)
    L.write(a.ledger, rows)
    emit("ledger-add", True, row=row, raw="")
    return 0


def cmd_ledger_status(a):
    rows = L.read(a.ledger)
    hit = [r for r in rows if r.get("主标题") == a.title]
    if not hit:
        emit("ledger-status", False, code="NOT_FOUND", message="台账里没有“%s”" % a.title, raw="")
        return 0
    hit[-1]["状态"] = a.to
    L.write(a.ledger, rows)
    emit("ledger-status", True, row=hit[-1], raw="")
    return 0


def cmd_ledger_show(a):
    rows = L.read(a.ledger)
    out = [dict(r, 内容线=r.get("内容线") or R.line_of(r)) for r in rows[-a.last:]]
    emit("ledger-show", True, rows=out, total=len(rows), raw="")
    return 0


def main():
    ap = argparse.ArgumentParser(description="writer-agent 头条规则桥")
    sub = ap.add_subparsers(dest="cmd", required=True)
    q = sub.add_parser("qa"); q.add_argument("--file", required=True); q.add_argument("--card")
    q.add_argument("--ledger"); q.add_argument("--mode"); q.add_argument("--title")
    sub.add_parser("rules"); sub.add_parser("limits")
    h = sub.add_parser("hot"); h.add_argument("--top", type=int, default=30)
    h.add_argument("--vertical", default="综合"); h.add_argument("--relevant", action="store_true")
    la = sub.add_parser("ledger-add"); la.add_argument("--card", required=True); la.add_argument("--ledger", required=True)
    la.add_argument("--status", default="已验收", choices=L.STATUSES)
    la.add_argument("--date", default=__import__("datetime").date.today().isoformat())
    ls = sub.add_parser("ledger-status"); ls.add_argument("--title", required=True)
    ls.add_argument("--to", required=True, choices=L.STATUSES); ls.add_argument("--ledger", required=True)
    lw = sub.add_parser("ledger-show"); lw.add_argument("--ledger", required=True); lw.add_argument("--last", type=int, default=10)
    a = ap.parse_args()
    fn = {"qa": cmd_qa, "rules": cmd_rules, "limits": cmd_limits, "hot": cmd_hot,
          "ledger-add": cmd_ledger_add, "ledger-status": cmd_ledger_status, "ledger-show": cmd_ledger_show}[a.cmd]
    try:
        return fn(a)
    except Exception as e:  # 契约：任何异常也只输出一个 JSON
        emit(a.cmd, False, code="SCRIPT_FAILED", message="%s: %s" % (type(e).__name__, e), raw="")
        return 0


if __name__ == "__main__":
    sys.exit(main())
