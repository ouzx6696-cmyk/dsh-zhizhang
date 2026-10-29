#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""toutiao-viral-writer 门禁回归测试与资产完整性校验。只依赖 Python 3 标准库。

    python3 tests/test_gates.py        # 全部通过退出码 0，任一失败退出码 1

夹具在 tests/fixtures/：good.md（资讯线标杆稿，短图文档）、billy.md（旧版账单味标杆）、
bad.md（AI 腔稿）、micro_good.md（微头条）、long_good.md（资讯线长图文实机稿）、
story_long_good.md + story_long_card.json（故事线长图文：精卫填海 + 别国同母题延伸）。
"""
import json, os, re, subprocess, sys, tempfile
import importlib.util as _ilu

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
QA = os.path.join(ROOT, "scripts", "qa_check.py")
FETCH = os.path.join(ROOT, "scripts", "fetch_hot.py")


def fixture(name):
    return open(os.path.join(HERE, "fixtures", name), encoding="utf-8").read()


GOOD, BILLY, BAD, MICRO = (fixture("good.md"), fixture("billy.md"),
                           fixture("bad.md"), fixture("micro_good.md"))
LONG = fixture("long_good.md")      # 3.1.0 长图文：主稿 + 延伸节（首篇实机稿扩写版）
STORY = fixture("story_long_good.md")   # 4.0.0 故事线长图文
STORY_CARD = json.load(open(os.path.join(HERE, "fixtures", "story_long_card.json"), encoding="utf-8"))

# 仅在首段注入 3 处中性裸“随着”，其余与 GOOD 完全一致
GOOD_ALONG = GOOD.replace(
    "老周说他今年冬天想把店里的鸡腿换便宜的。",
    "随着天气一天天凉下来，老周说他今年冬天想把店里的鸡腿换便宜的。",
).replace(
    "说实话，平台这两年确实降过佣金。",
    "随着单量慢慢稳下来，说实话，平台这两年确实降过佣金。",
).replace(
    "利润薄成这样，店家能动的地方不多",
    "随着罚单越积越多，利润薄成这样，店家能动的地方不多",
)

# 3 处模板形态“随着…的发展”，与 GOOD_ALONG 逐字对应
GOOD_ALONG_TPL = GOOD_ALONG.replace("随着天气一天天凉下来", "随着天气的发展") \
                            .replace("随着单量慢慢稳下来", "随着平台的推进") \
                            .replace("随着罚单越积越多", "随着行业的进步")

results = []


def run(md, title=None, expect_exit=None, extra=None):
    """把 md 写临时文件跑质检，返回 (report, exit_code)。"""
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False,
                                     encoding="utf-8") as f:
        f.write(md)
        path = f.name
    try:
        cmd = [sys.executable, QA, path, "--json"]
        if title:
            cmd += ["--title", title]
        if extra:
            cmd += extra
        p = subprocess.run(cmd, capture_output=True, text=True)
        report = None
        try:
            report = json.loads(p.stdout)
        except Exception:
            pass
        return report, p.returncode, p.stderr
    finally:
        os.unlink(path)


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"{'  ok  ' if cond else ' FAIL '} {name}" + (f"  <- {detail}" if detail else ""))


def item(report, key):
    return next(i for i in report["items"] if i["key"] == key)


print("== 1. 优质稿应放行 ==")
r, code, _ = run(GOOD, title="25元的外卖商家只到手6.08元：这笔账，比想象中难看")
check("优质稿 exit=0", code == 0, f"exit={code}")
check("优质稿 overall>=84", r and r["overall"] >= 84, f"overall={r and r['overall']}")
check("优质稿 passed=True", r and r["passed"] is True)
check("优质稿 AI 味 pass", item(r, "ai")["status"] == "pass", f"ai={item(r,'ai')['score']}")

print("== 2. AI 腔稿应打回 ==")
r2, code2, _ = run(BAD)
check("AI 腔稿 exit=1", code2 == 1, f"exit={code2}")
check("AI 腔稿 passed=False", r2 and r2["passed"] is False)
check("AI 腔稿 overall<84", r2 and r2["overall"] < 84, f"overall={r2 and r2['overall']}")
check("AI 腔稿六维全不 pass 或 fail",
      all(i["status"] != "pass" for i in r2["items"]) or
      any(i["status"] == "fail" for i in r2["items"]))

print("== 3. “随着”双档分流 ==")
ra, codea, _ = run(GOOD_ALONG, title="25元的外卖商家只到手6.08元：这笔账，比想象中难看")
ai_a = item(ra, "ai")
check("裸随着×3 不判 fail", ai_a["status"] == "pass", f"ai={ai_a['score']} {ai_a['status']}")
check("裸随着报告标注“仅提示”", "仅提示" in ai_a["note"], ai_a["note"][-30:])
check("裸随着 exit=0", codea == 0, f"exit={codea}")

rt, codet, _ = run(GOOD_ALONG_TPL, title="25元的外卖商家只到手6.08元：这笔账，比想象中难看")
ai_t = item(rt, "ai")
check("模板形态随着×3 判 fail", ai_t["status"] == "fail", f"ai={ai_t['score']} {ai_t['status']}")
check("两档分值显著拉开", ai_t["score"] <= ai_a["score"] - 15,
      f"模板{ai_t['score']} vs 裸{ai_a['score']}")

print("== 4. 三项一票否决硬伤 ==")
ph = GOOD.replace("老周说，他不是不能接受平台收钱。",
                  "老周说，他是{人}，不是不能接受平台收钱。")
rp, codep, _ = run(ph, title="25元的外卖商家只到手6.08元：这笔账，比想象中难看")
check("占位符未替换 → 禁止通过", rp and rp["passed"] is False,
      f"passed={rp and rp['passed']} unfilled={rp and rp['risk_flags']}")

leak = GOOD.replace("老周说，他不是不能接受平台收钱。",
                    "作为AI，老周说他不是不能接受平台收钱。")
rl, codel, _ = run(leak, title="25元的外卖商家只到手6.08元：这笔账，比想象中难看")
check("AI 身份泄漏 → 禁止通过", rl and rl["passed"] is False,
      f"ai={item(rl,'ai')['score']} cp={item(rl,'compliance')['score']}")

print("== 5. 标题缺失 ==")
_, code_nt, err_nt = run("正文没有标题也没有 --title 参数。")
check("无标题退出码 2", code_nt == 2, f"exit={code_nt} {err_nt.strip()[:40]}")

print("== 5b. 标题 34 字硬上限 ==")
LONG_TITLE = "25元的外卖商家实际只到手6.08元，我把一个黄焖鸡老板的结算单一笔笔拆开算清了"
rl2, codel2, _ = run(GOOD, title=LONG_TITLE)
check("超长标题 → 禁止通过", rl2 and rl2["passed"] is False,
      f"标题{len(LONG_TITLE)}字 overall={rl2 and rl2['overall']}")
check("超长标题 exit=1", codel2 == 1, f"exit={codel2}")
check("风险清单点名 34 字上限",
      any("34" in f for f in (rl2 or {}).get("risk_flags", [])),
      (rl2 or {}).get("risk_flags", [])[:1])

ok34 = "25元的外卖商家只到手6.08元：这笔账比想象中难看真的太难了算不清"
assert len(ok34) == 34, f"夹具标题应恰为 34 字，实际 {len(ok34)}"
r34, code34, _ = run(GOOD, title=ok34)
check("34 字标题（等于上限）仍放行", r34 and r34["passed"] is True,
      f"标题{len(ok34)}字 overall={r34 and r34['overall']}")
check("34 字标题 exit=0", code34 == 0, f"exit={code34}")

over35 = ok34 + "啊"
assert len(over35) == 35, f"夹具标题应为 35 字，实际 {len(over35)}"
r35, code35, _ = run(GOOD, title=over35)
check("35 字标题（超 1 字）即禁交", r35 and r35["passed"] is False,
      f"标题{len(over35)}字 overall={r35 and r35['overall']}")
check("35 字标题 exit=1", code35 == 1, f"exit={code35}")

print("== 6. 门禁双向有效性（不能放过该拦的，也不能冤杀该过的） ==")
check("双向：优质稿过、AI 腔稿拦",
      code == 0 and code2 == 1, f"good={code} bad={code2}")

print("== 7. 权重归一化（2026-09 修正，防 1.04 回归） ==")
import importlib.util as _ilu
_sp = _ilu.spec_from_file_location("_qa", QA)
_qm = _ilu.module_from_spec(_sp); _sp.loader.exec_module(_qm)
_wsum = sum(_qm.WEIGHTS.values())
check("六维权重合计恰为 1", abs(_wsum - 1.0) < 1e-12, f"sum={_wsum!r}")
check("权重未退回 0.24/0.16/0.14/0.18 旧值",
      abs(_qm.WEIGHTS["ai"] - 0.24) > 1e-9 and abs(_qm.WEIGHTS["compliance"] - 0.18) > 1e-9,
      f'ai={_qm.WEIGHTS["ai"]:.6f} compliance={_qm.WEIGHTS["compliance"]:.6f}')
# 六维满分时 overall 必须是 100，不再被 1.04 撑到 104 后被 clamp
_rat = _qm.clamp(100 * _qm.WEIGHTS["ai"] + 100 * _qm.WEIGHTS["read"] + 100 * _qm.WEIGHTS["title"]
                 + 100 * _qm.WEIGHTS["detail"] + 100 * _qm.WEIGHTS["structure"]
                 + 100 * _qm.WEIGHTS["compliance"])
check("六维全 100 时 overall=100（非 clamp 后的假 100）", _rat == 100, f"overall={_rat}")

print("== 8. 技能资产完备度与槽位规范检查 ==")
expected_refs = ["s1-hot.md", "s1-evergreen.md", "s2-selection.md", "s3-headline.md", "s4-common.md",
                 "s4-news.md", "s4-story.md", "s4-micro.md", "s5-editing.md", "s6-qa.md", "s7-delivery.md"]
VERTS = ["民生社保", "职场就业", "房产楼市", "教育升学", "健康养老", "三农乡土",
         "情感家庭", "财经理财", "汽车出行", "科技数码", "社会观察", "文旅消费"]
expected_corpus = (["common.md", "benchmark.md"] + [f"{i + 1:02d}-{v}.md" for i, v in enumerate(VERTS)]
                   + ["story/motifs.md", "story/texture.md"])
missing_refs = [f for f in expected_refs if not os.path.isfile(os.path.join(ROOT, "references", f))]
missing_corpus = [f for f in expected_corpus if not os.path.isfile(os.path.join(ROOT, "corpus", f))]
check("11 份步骤文件齐全", not missing_refs, f"missing={missing_refs}")
check("语料库 common + 12 垂类 + 标杆 + 故事线两份齐全", not missing_corpus, f"missing={missing_corpus}")
brace_leaks = []
for d, fs in (("references", expected_refs), ("corpus", expected_corpus)):
    for f in fs:
        if f == "s6-qa.md":
            continue
        content = open(os.path.join(ROOT, d, f), encoding="utf-8").read()
        hits = re.findall(r"\{[\u4e00-\u9fa5A-Za-z0-9_]{1,8}\}", content)
        if hits:
            brace_leaks.append((f, hits))
check("槽位统一使用 [方括号] 无 {花括号} 误用", not brace_leaks, f"leaks={brace_leaks}")


print("== 9. 2026-10 优化回归 ==")
TT = "25元的外卖商家只到手6.08元：这笔账，比想象中难看"
check("身份泄漏写入 hard_gates", rl and "AI身份泄漏" in rl.get("hard_gates", []),
      f"hard_gates={rl and rl.get('hard_gates')}")

other = GOOD.replace("老周说，他不是不能接受平台收钱。",
                     "老周说，他不是不能接受平台收钱，其他店主也一样。")
ro, _, _ = run(other, title=TT)
def _pm(r):
    m = re.search(r"人称错位(\d+)段", item(r, "ai")["note"]); return int(m.group(1)) if m else 0
_rs0 = run(GOOD, title=TT)[0]
check("“其他”不触发他/她混用", _pm(ro) == _pm(_rs0), f"{_pm(ro)} vs 基线{_pm(_rs0)}")

mix = GOOD.replace("老周说，他不是不能接受平台收钱。",
                   "老周说，他不是不能接受平台收钱，她也不能。")
rm, _, _ = run(mix, title=TT)
check("真实他/她混用仍被抓", _pm(rm) > _pm(_rs0), f"{_pm(rm)} vs 基线{_pm(_rs0)}")

rs = run(GOOD, title=TT)[0]
check("一级标题不计入小节数", "3个小节" in item(rs, "structure")["note"], item(rs, "structure")["note"])

rq, cq, _ = run(GOOD, title=TT, extra=["--mode", "deep"])
check("--mode deep 是 short 的别名", rq["mode"] == "short", rq["mode"])
check("短图文 1100~2200：标杆稿在档内不提示", not any("图文应为" in f for f in rq["risk_flags"]), f"chars={rq['chars']}")
rql, cql, _ = run(GOOD, title=TT, extra=["--mode", "long"])
check("--mode long：短稿给篇幅提示", any("长图文应为" in f for f in rql["risk_flags"]), f"chars={rql['chars']}")
check("不给 --mode 时不做分档提示", not any("图文应为" in f for f in rs["risk_flags"]))
check("篇幅分档只提示不否决（档外仍可通过）", rql["passed"] is True and cql == 0, f"overall={rql['overall']}")

import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("qa_mod2", QA); _q2 = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_q2)
check("语气词只在句末计（哈尔滨不算）", len(_q2.PARTICLE_RE.findall("他去了哈尔滨。")) == 0
      and len(_q2.PARTICLE_RE.findall("走吧。好呢？")) == 2)

img_first = GOOD.replace("# " + TT + "\n\n", "# " + TT + "\n\n![封面](cover.jpg)\n\n", 1)
ri, _, _ = run(img_first, title=TT)
check("首行图片不被当成首段/段落", ri and ri["chars"] == rs["chars"], f"{ri and ri['chars']} vs {rs['chars']}")

rb, _, _ = run(BILLY, title=TT)
check("账单味：数字堆段的旧标杆稿被扣分", rb["bill_flavor"]["penalty"] >= 10,
      f"bill={rb['bill_flavor']}")
check("账单味：新标杆稿不扣或少扣", _rs0["bill_flavor"]["penalty"] < rb["bill_flavor"]["penalty"]
      and item(_rs0, "detail")["score"] > item(rb, "detail")["score"],
      f"新{_rs0['bill_flavor']['penalty']} vs 旧{rb['bill_flavor']['penalty']}")
check("标题不带数字、只有身份也能过标题线",
      item(run(GOOD, title="开了六年黄焖鸡的老周，最近不敢看后台了")[0], "title")["status"] == "pass")

_fs = _ilu.spec_from_file_location("fetch_mod", os.path.join(ROOT, "scripts", "fetch_hot.py"))
_fh = _ilu.module_from_spec(_fs); _fs.loader.exec_module(_fh)
check("红线：涉政/伤亡/明星私生活被拦", all(_fh.is_risky(t) for t in
      ["15个中央巡视组组长公布", "某地男子坠楼身亡", "某明星官宣离婚"]))
check("红线：民生条目不误杀", not any(_fh.is_risky(t) for t in
      ["2027年国考345万人过审", "安徽启动2027年居民医保筹资工作", "内存价格出现倒挂"]))
check("认不出的条目标“未分类”而非“社会观察”", _fh.vertical_of("U17女足世界杯中国3:2美国") == "未分类")


print("== 10. 2.0.0 回归 ==")
_qa = _ilu.module_from_spec(_ilu.spec_from_file_location("qa20", QA)); _ilu.spec_from_file_location("qa20", QA).loader.exec_module(_qa)
check("脚本带版本号", _qa.VERSION == "4.0.0" and _rs0.get("version") == _qa.VERSION)

mark = GOOD.replace("## 二、", "【配图：老周在后厨过秤】\n\n## 二、", 1)
rmk, _, _ = run(mark, title=TT)
check("【配图：…】标记不计入字数", rmk["chars"] == _rs0["chars"], f"{rmk['chars']} vs {_rs0['chars']}")
check("【配图：…】标记计入配图分", item(rmk, "structure")["score"] >= item(_rs0, "structure")["score"])

hd = GOOD.replace("## 三、点外卖的人，也没占到便宜", "## 三、综上所述，点外卖的人也没占到便宜")
rhd, _, _ = run(hd, title=TT)
check("小标题里的黑名单词也会被扫到", any(w == "综上所述" for w, _ in rhd["ai_traces"]), rhd["ai_traces"][:2])

rtb, _, _ = run(GOOD, title="惊呆！25元的外卖商家只到手6.08元，这笔账太难看")
check("标题党词（惊呆）在标题里重罚", item(rtb, "title")["score"] < 70, f"title={item(rtb,'title')['score']}")
check("不禁单字“最”：“最怕”不扣标题分",
      _qa.title_score("开了六年黄焖鸡的老周，最怕的是看后台") >= 80)

short_dup = GOOD.replace("女儿在群里问他是不是看错了。他回了一个字：没。",
                         "女儿在群里问他是不是看错了。他没接话。过了一会儿又问。他没接话。")
rsd, _, _ = run(short_dup, title=TT)
check("短句重复（他没接话。×2）不算重复句", not any("重复出现" in f for f in rsd["risk_flags"]),
      rsd["risk_flags"][:2])
check("引号紧跟句号时切句不留孤立引号",
      _qa.split_sents("他说：“走吧。”然后走了。") == ["他说：“走吧。”", "然后走了。"])
check("“——”算一处呼吸点，不是两处", len(re.findall(r"—{1,2}|…{1,2}", "一——二……三")) == 2)
check("沿用示例人名只给提示、不扣分", any("示例人名" in h for h in _rs0["hints"]) and _rs0["passed"])

print("== 11. 微头条模式 ==")
rmi, cmi, _ = run(MICRO, extra=["--mode", "micro"])
check("微头条无标题也能跑（--mode micro）", cmi in (0, 1) and rmi is not None, f"exit={cmi}")
check("微头条标杆通过", rmi and rmi["passed"], f"overall={rmi and rmi['overall']}")
check("微头条按首句打钩子分", rmi and rmi["title"].startswith("楼下修鞋的老钟"), rmi and rmi["title"])
check("微头条不要求小标题", rmi and item(rmi, "structure")["status"] == "pass")
_, cnt, _ = run(MICRO)
check("非 micro 模式缺标题仍退出码 2", cnt == 2, f"exit={cnt}")
rbm, cbm, _ = run(BAD.split("\n", 1)[1], extra=["--mode", "micro"])
check("AI 腔稿在微头条模式下照样打回", cbm == 1 and not rbm["passed"])

print("== 12. 抓榜：名次融合、趋势、红线 ==")
_f = _ilu.module_from_spec(_ilu.spec_from_file_location("fh20", FETCH)); _ilu.spec_from_file_location("fh20", FETCH).loader.exec_module(_f)
check("名次融合：第1名1分、第50名0.02分、50名外0分",
      _f.rank_points(1) == 1.0 and _f.rank_points(50) == 0.02 and _f.rank_points(60) == 0)
prev = {_f.norm("养老金调整方案公布"): 10, _f.norm("国考报名人数创新高"): 3}
check("趋势：新上榜=new", _f.trend_of(_f.norm("公积金新规"), 5, prev) == "new")
check("趋势：名次前进≥3=up", _f.trend_of(_f.norm("养老金调整方案公布"), 4, prev) == "up")
check("趋势：名次后退≥3=down", _f.trend_of(_f.norm("国考报名人数创新高"), 9, prev) == "down")
check("趋势：变化<3=flat", _f.trend_of(_f.norm("养老金调整方案公布"), 9, prev) == "flat")
check("红线：外国大选/台湾政治/窃密被拦", all(_f.is_risky(t) for t in
      ["巴西大选卢拉因何实现逆风翻盘", "韩国瑜再提我是中国人", "女子窃30万份国家秘密报复同事"]))
check("体育赛事里的“男子”不再标成社会观察", _f.vertical_of("潘展乐斩获男子100米个人混合泳冠军") == "未分类")
check("健康类热点能认出（血脂）", _f.vertical_of("花生是血脂杀手吗") == "健康养老")

print("== 13. 文档一致性 ==")
def _read(rel):
    return open(os.path.join(ROOT, rel), encoding="utf-8").read()
skill = _read("SKILL.md")
docs = {f: _read(os.path.join("references", f)) for f in expected_refs}
docs.update({"corpus/" + f: _read(os.path.join("corpus", f)) for f in expected_corpus})
alltext = "\n".join(list(docs.values()) + [skill])
refd = set(re.findall(r"(s\d-[a-z]+\.md)", skill))
check("SKILL.md 点名的步骤文件都存在", all(f in expected_refs for f in refd), sorted(refd))
check("每份步骤文件都在 SKILL.md 里有路由", set(expected_refs) <= refd, sorted(set(expected_refs) - refd))
check("SKILL.md 只做路由（<9000 字节）", len(skill.encode("utf-8")) < 9000, len(skill.encode("utf-8")))
old_names = ["anti_ai_before.md", "anti_ai_after.md", "humanize.md", "proofreading.md", "corpus.md",
             "hotlist.md", "selection.md", "headline.md", "delivery.md", "micro.md",
             "s1-hotlist.md", "s4-writing.md"]          # 后两个是 3.x 的文件名，4.0.0 拆掉了
stale_refs = sorted({n for n in old_names for m in re.finditer(r"(?<![\w\-/])" + re.escape(n), alltext)})
check("没有指向旧文件名的引用", not stale_refs, stale_refs)
mentioned = set(re.findall(r"`?((?:references|corpus|templates|scripts)/[^\s`）)，。]+\.(?:md|json|py))", alltext))
missing_paths = sorted(p for p in mentioned if "NN-" not in p and "*" not in p and not os.path.exists(os.path.join(ROOT, p)))
check("文档里提到的路径都真实存在", not missing_paths, missing_paths)
stale = [f for f, c in docs.items() if re.search(r"15\s*大病型|十五病型|15 个典型病型", c)]
check("病型数量统一为 16", not stale, stale)
orphan = []
for f, c in docs.items():
    lines = c.splitlines()
    for i, ln in enumerate(lines):
        if ln.startswith("---|") and (i == 0 or not lines[i - 1].lstrip().startswith("|")):
            orphan.append(f"{f}:{i + 1}")
check("没有断掉的表格残片", not orphan, orphan)
check("作品声明路径不是抖音的“高级设置”", "高级设置 → 作品声明" not in alltext)
check("s6-qa.md 不再抄六维计分明细（规则只在 rules.py）", "基准 78 分" not in docs["s6-qa.md"])
check("CHANGELOG 存在", os.path.isfile(os.path.join(ROOT, "CHANGELOG.md")))
for t in ["brief.json", "交稿单-图文.md"]:
    check(f"模板 {t} 存在", os.path.isfile(os.path.join(ROOT, "templates", t)))
_brief = json.load(open(os.path.join(ROOT, "templates", "brief.json"), encoding="utf-8"))
check("立项卡模板字段齐全", all(k in _brief for k in
      ["垂类", "主驱动", "体裁", "锚点人物", "主数字", "开头式", "结尾式", "主标题", "出处"]))
_bl = _qa.R.line_of(_brief)
check("立项卡模板的枚举值合法", _brief["主驱动"] in _qa.DRIVERS and _brief["体裁"] in _qa.GENRE_MODE
      and _brief["开头式"] in _qa.OPENINGS[_bl] and _brief["结尾式"] in _qa.ENDINGS[_bl]
      and _brief["延伸"]["接法"] in _qa.EXT_WAYS[_bl])

print("== 14. 3.0.0：规则源、主驱动预算、立项卡、台账 ==")
check("规则单一来源：qa_check 的词表就是 rules.py 的对象",
      _qa.AI_WORDS is _qa.R.AI_WORDS and _qa.WEIGHTS is _qa.R.WEIGHTS)
pr = subprocess.run([sys.executable, QA, "--rules"], capture_output=True, text=True)
check("--rules 输出规则且退出码 0", pr.returncode == 0 and "主驱动数字预算" in pr.stdout and "处境型" in pr.stdout)
check("--rules 的及格线来自 rules.py", all(f"| {k} |" in pr.stdout for k in _qa.PASS_LINE))

rz, _, _ = run(GOOD, title=TT, extra=["--driver", "账本型"])
rc, _, _ = run(GOOD, title=TT, extra=["--driver", "处境型"])
rh, _, _ = run(GOOD, title=TT, extra=["--driver", "情感型"])
check("标杆账本型稿在账本型预算内", rz["budget"]["penalty"] == 0, rz["budget"])
check("同一篇按处境型查会超预算", rc["budget"]["penalty"] > 0 and item(rc, "detail")["score"] < item(rz, "detail")["score"],
      rc["budget"])
check("情感型预算比处境型更紧", rh["budget"]["penalty"] >= rc["budget"]["penalty"])
check("不给主驱动时不查预算", _rs0["budget"] is None)
conv = GOOD.replace("女儿在群里问他是不是看错了。", "女儿说这相当于白干。又说相当于倒贴。女儿在群里问他是不是看错了。")
rcv, _, _ = run(conv, title=TT, extra=["--driver", "账本型"])
check("换算超过预算会扣分", rcv["budget"]["convert"] >= 2 and rcv["budget"]["penalty"] > 0, rcv["budget"])
endnum = GOOD.replace("评论区聊聊。", "评论区聊聊，他一天卖 40 单。")
ren, _, _ = run(endnum, title=TT)
check("结尾出现数字：结构扣分并提示", item(ren, "structure")["score"] < item(_rs0, "structure")["score"]
      and any("最后一段出现了数字" in f for f in ren["risk_flags"]))
rtn, ctn, _ = run(GOOD, title="35元的外卖商家只到手6.08元：这笔账，比想象中难看")
check("标题数字正文没出现 → 硬闸", "标题数字正文没接住" in rtn["hard_gates"] and ctn == 1, rtn["hard_gates"])

tmpd = tempfile.mkdtemp()
_card_n = [0]
def _card(**kw):
    c = json.loads(json.dumps(_brief)); c.update(kw)
    _card_n[0] += 1
    p = os.path.join(tmpd, f"card{_card_n[0]}.json")      # 每张卡一个文件，免得后面的调用覆盖前面还要用的卡
    json.dump(c, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    return p
ledger_p = os.path.join(tmpd, "log.csv")
base = dict(主驱动="账本型", 体裁="短图文", 主标题=TT, 主数字="6.08", 主数字出处="用户素材",
            锚点人物={"名字": "老周", "真实案例": False, "来源": "", "人称": "他"},
            出处=[{"事实": "6.08", "链接": "用户素材"}])
rk, ck, _ = run(GOOD, extra=["--card", _card(**base), "--ledger", ledger_p])
check("立项卡带出体裁与主驱动", rk["mode"] == "short" and rk["budget"]["driver"] == "账本型", rk["mode"])
check("立项卡与成稿相符时通过", rk["passed"] and ck == 0, rk.get("card_checks"))
check("立项卡提示示例人名", any("示例人名" in m for _, m in rk["card_checks"]))
rk2, ck2, _ = run(GOOD, extra=["--card", _card(**{**base, "锚点人物": {"名字": "老覃", "真实案例": False}}), "--ledger", ledger_p])
check("锚点人物正文没出现 → 立项卡不符", "立项卡不符" in rk2["hard_gates"] and ck2 == 1)
rk3, _, _ = run(GOOD, extra=["--card", _card(**{**base, "主数字": "7.15"}), "--ledger", ledger_p])
check("主数字正文没出现 → 立项卡不符", "立项卡不符" in rk3["hard_gates"])
fake = GOOD.replace("他跟隔壁卖麻辣烫的老板娘聊过这事。", "我表弟上周也开了家店。他跟隔壁卖麻辣烫的老板娘聊过这事。")
rk4, _, _ = run(fake, extra=["--card", _card(**base), "--ledger", ledger_p])
check("合成人物写成作者亲历 → 立项卡不符", any("作者亲历" in m for lv, m in rk4["card_checks"] if lv == "fail"))
rk5, _, _ = run(fake, extra=["--card", _card(**{**base, "锚点人物": {"名字": "老周", "真实案例": True, "来源": "用户口述"}}),
                             "--ledger", ledger_p])
check("真实案例时不拦亲历写法", not any("作者亲历" in m for _, m in rk5["card_checks"]))
rk6, _, _ = run(GOOD, extra=["--card", _card(**{**base, "主驱动": "账单型"}), "--ledger", ledger_p])
check("主驱动写错 → 立项卡不符", "立项卡不符" in rk6["hard_gates"])

LG = os.path.join(ROOT, "scripts", "ledger.py")
cp = _card(**{**base, "开头式": "现场动作", "结尾式": "潜台词追问", "垂类": "职场就业"})
cp_prev = os.path.join(tmpd, "prev.json")
_prev = json.load(open(cp, encoding="utf-8")); _prev["主标题"] = "上一篇的标题"
json.dump(_prev, open(cp_prev, "w", encoding="utf-8"), ensure_ascii=False)
p1 = subprocess.run([sys.executable, LG, "add", "--card", cp_prev, "--ledger", ledger_p], capture_output=True, text=True)
check("ledger add 记一行", p1.returncode == 0 and os.path.isfile(ledger_p), p1.stdout + p1.stderr)
rk7, _, _ = run(GOOD, extra=["--card", cp, "--ledger", ledger_p])
msgs = [m for _, m in rk7["card_checks"]]
check("台账：开头式与同一条线上一篇相同被提示", any("开头式和资讯线上一篇一样" in m for m in msgs), msgs)
check("台账：人名最近用过被提示", any("撞脸" in m for m in msgs))
check("台账：同赛道同日被提示", any("同赛道同日" in m for m in msgs))
for _ in range(2):
    subprocess.run([sys.executable, LG, "add", "--card", cp_prev, "--ledger", ledger_p], capture_output=True)
rk8, _, _ = run(GOOD, extra=["--card", cp, "--ledger", ledger_p])
check("台账：近 7 天账本型过半被提示", any("账本型" in m and "超过一半" in m for _, m in rk8["card_checks"]))
p2 = subprocess.run([sys.executable, LG, "status", "--title", "上一篇的标题", "--to", "已交稿", "--ledger", ledger_p],
                    capture_output=True, text=True)
check("ledger status 改状态", p2.returncode == 0 and "已交稿" in open(ledger_p, encoding="utf-8-sig").read())
check("台账不存在时跳过台账检查", not any("台账" in m for _, m in
      run(GOOD, extra=["--card", cp, "--ledger", os.path.join(tmpd, "none.csv")])[0]["card_checks"]))

print("== 15. 3.0.1：实机回归 ==")
bold = GOOD.replace("他跟隔壁卖麻辣烫的老板娘聊过这事。",
                    "**先看后台。** 他跟隔壁卖麻辣烫的老板娘聊过这事。\n\n**再问同行。** 老板娘也是这么说的。\n\n**最后算账。** 两家都差不多。")
rb, _, _ = run(bold, title=TT)
check("加粗领句不算段首重复、不算排比", rb["rhythm"] and item(rb, "ai")["score"] >= item(_rs0, "ai")["score"] - 6
      and "段首重复" not in item(rb, "read")["note"].replace("段首重复1处", ""), item(rb, "read")["note"])

selfp = os.path.join(tmpd, "self.csv")
subprocess.run([sys.executable, LG, "add", "--card", cp, "--ledger", selfp], capture_output=True)
rself, _, _ = run(GOOD, extra=["--card", cp, "--ledger", selfp])
check("已入台账的本篇复检时不跟自己撞车", not any(("撞脸" in m or "同赛道" in m or "上一篇" in m) for _, m in rself["card_checks"]),
      rself["card_checks"])

print("== 16. 3.0.2：标点规范硬闸 ==")
_P = lambda txt: [l for l, _, _ in _qa.punct_issues([txt])]
check("直角引号判违规", "直角引号" in _P("她说「走吧」。"))
check("中文里夹半角逗号判违规", "半角标点" in _P("他走了,没回头。"))
check("英文直引号判违规", "英文直引号" in _P('他说"走吧"。'))
check("波浪号判违规", "波浪号" in _P("等了3~5天。"))
check("单个省略号、单个破折号判违规", {"省略号不规范", "破折号不规范"} <= set(_P("他说…我想想—算了。")))
check("装饰符号判违规", "装饰符号" in _P("★先备份。"))
check("规范写法不误伤：“”‘’……——《》（）、比分和时刻", _P("他说：“她讲‘算了’……”——《通知》（试行）里写着，比分3:2，10:30开门。") == [])
pb, _, _ = run("# 标题\n\n" + GOOD.split("\n", 2)[-1].replace("他跟隔壁", "**他跟隔壁**", 1), title=TT)
check("正文留 **加粗** 触发硬闸", "非规范标点" in pb["hard_gates"], pb["hard_gates"])
pq, _, _ = run(GOOD.replace("“", "「", 1).replace("”", "」", 1), title=TT)
check("直角引号让好稿也被硬闸拦下", "非规范标点" in pq["hard_gates"] and not pq["passed"], pq["hard_gates"])
check("好稿本身标点规范", _rs0["hard_gates"] == [], _rs0["hard_gates"])

print("== 17. 3.1.0：长图文（主稿 + 延伸节）与故事型 ==")
EXT_H = "五、卡拔出来了，旧号码先别急着去销"
lbase = dict(主驱动="信息型", 体裁="长图文", 垂类="科技数码", 主标题="", 主数字="", 主数字出处="",
             锚点人物={"名字": "钟姐", "真实案例": False, "来源": "", "人称": "她"},
             延伸={"起始小标题": EXT_H, "接的问题": "旧号码要不要销"}, 开头式="现场动作", 结尾式="帮亲友问计",
             出处=[{"事实": "x", "链接": "y"}])
nolog = os.path.join(tmpd, "none2.csv")
rl, cl, _ = run(LONG, extra=["--card", _card(**lbase), "--ledger", nolog])
check("长图文实机稿通过", rl["passed"] and cl == 0 and rl["mode"] == "long", (rl["overall"], rl["hard_gates"], rl["risk_flags"]))
e = rl["extension"] or {}
check("长图文分出主稿和延伸节字数", 1700 <= e.get("main_chars", 0) <= 2300 and 800 <= e.get("ext_chars", 0) <= 1300, e)
check("延伸节与主稿重合度低", e.get("overlap", 1) < _qa.EXT_OVERLAP_WARN, e)
check("长图文不吃 2600 字以上的完读率扣分", not any("超过2600字" in f for f in rl["risk_flags"]))
check("长图文数字预算按比例放宽", rl["budget"]["numbers_max"] == round(_qa.DRIVERS["信息型"]["numbers"] * _qa.LONG_BUDGET_SCALE))
rd_, _, _ = run(LONG, title="t", extra=["--mode", "deep"])
check("同一篇按短图文（deep 别名）查会报篇幅超档", any("短图文应为" in f for f in rd_["risk_flags"]))
_i = LONG.index("## " + EXT_H)
_main = LONG[:_i]
_sec3 = _main[_main.index("## 三、"):_main.index("## 四、")].split("\n", 1)[1]
dupe = LONG.rstrip() + "\n\n## 七、再说一遍\n\n" + _sec3
rdp, cdp, _ = run(dupe, extra=["--card", _card(**lbase), "--ledger", nolog])
check("延伸节照抄主稿 → 硬闸“延伸节重复主稿”", "延伸节重复主稿" in rdp["hard_gates"] and cdp == 1, rdp["extension"])
rne, _, _ = run(LONG, extra=["--card", _card(**{**lbase, "延伸": {}}), "--ledger", nolog])
check("长图文立项卡没写延伸 → 立项卡不符", "立项卡不符" in rne["hard_gates"])
rwh, _, _ = run(LONG, extra=["--card", _card(**{**lbase, "延伸": {"起始小标题": "不存在的小标题", "接的问题": "x"}}), "--ledger", nolog])
check("延伸起始小标题正文里找不到 → 立项卡不符", any("找不到延伸节小标题" in m for lv, m in rwh["card_checks"] if lv == "fail"))
rnx, _, _ = run(LONG, title="t", extra=["--mode", "long"])
check("长图文不标延伸起点只提示不崩", any("没标延伸节从哪开始" in f for f in rnx["risk_flags"]) and rnx["extension"] is None)
rxa, _, _ = run(LONG, title="t", extra=["--mode", "long", "--ext", EXT_H])
check("--ext 参数可替代立项卡", rxa["extension"] is not None)
noname = LONG[:_i] + LONG[_i:].replace("钟姐", "她")
rnn, _, _ = run(noname, extra=["--card", _card(**lbase), "--ledger", nolog])
check("延伸节锚点人物没再出现 → 提示", any("延伸节里“钟姐”没再出现" in m for _, m in rnn["card_checks"]))
myth = GOOD.replace("他跟隔壁卖麻辣烫的老板娘聊过这事。", "相传这条街以前是河道。据传老街坊都知道。他跟隔壁卖麻辣烫的老板娘聊过这事。")
rm1, _, _ = run(myth, title=TT, extra=["--driver", "故事型"])
rm2, _, _ = run(myth, title=TT, extra=["--driver", "信息型"])
check("故事型里“据传”不算未经证实信息", not any("未经证实" in f for f in rm1["risk_flags"]))
check("非故事型照旧拦“据传”", any("未经证实" in f for f in rm2["risk_flags"]))
check("故事型预算存在且最紧之一", "故事型" in _qa.DRIVERS and _qa.DRIVERS["故事型"]["numbers"] <= _qa.DRIVERS["处境型"]["numbers"])
rst, _, _ = run(GOOD, extra=["--card", _card(**{**base, "主驱动": "故事型", "内容线": ""}), "--ledger", nolog])
check("旧立项卡（无内容线）主驱动故事型 → 按故事线查，缺改编方式提示",
      rst["line"] == "故事线" and any("改编方式" in m for _, m in rst["card_checks"]), rst["line"])
check("立项卡模板默认长图文且带延伸字段", _brief["体裁"] == "长图文" and "起始小标题" in _brief.get("延伸", {}))
check("s7 写明头条首发四条，不再写“声明原创”", "头条首发" in docs["s7-delivery.md"] and "“声明原创 /" not in docs["s7-delivery.md"])
check("s4-common 写明延伸是扩写不是拼接", "延伸是扩写，不是拼接" in docs["s4-common.md"])
check("s4-story 写明两项声明与版本出处", "虚构演绎，故事经历" in docs["s4-story.md"] and "版本" in docs["s4-story.md"])

print("== 18. 4.0.0：两条内容线 × 长图文 ==")
SC = _card(**STORY_CARD)
rs1, cs1, _ = run(STORY, extra=["--card", SC, "--ledger", nolog])
check("故事线长图文夹具通过", rs1["passed"] and cs1 == 0, (rs1["overall"], rs1["hard_gates"], rs1["risk_flags"]))
check("故事线：立项卡带出内容线与故事型", rs1["line"] == "故事线" and rs1["budget"]["driver"] == "故事型", rs1["line"])
e1 = rs1["extension"] or {}
check("故事线夹具主稿 1700~2300、延伸 800~1300", 1700 <= e1.get("main_chars", 0) <= 2300 and 800 <= e1.get("ext_chars", 0) <= 1300, e1)
check("故事线夹具全文约 3000 字（2600~3400）", 2600 <= rs1["chars"] <= 3400, rs1["chars"])
check("故事线夹具延伸与主稿几乎不重合", e1.get("overlap", 1) < _qa.EXT_OVERLAP_WARN, e1)
check("故事线夹具立项卡零提示", rs1["card_checks"] == [], rs1["card_checks"])
check("故事线夹具标点规范（含不用间隔号）", "非规范标点" not in rs1["hard_gates"] and "·" not in STORY and "「" not in STORY)
check("故事线夹具在故事型预算内", rs1["budget"]["penalty"] == 0, rs1["budget"])
check("故事型细节分不靠数字（有底分）", item(rs1, "detail")["status"] == "pass", item(rs1, "detail"))
rs2, _, _ = run(STORY, extra=["--mode", "long", "--line", "故事线", "--ext", STORY_CARD["延伸"]["起始小标题"]])
check("--line 故事线不给 --driver 时按故事型查", rs2["budget"] and rs2["budget"]["driver"] == "故事型" and rs2["line"] == "故事线")
check("资讯线长图文夹具仍通过（立项卡补了内容线）",
      run(LONG, extra=["--card", _card(**{**lbase, "内容线": "资讯线"}), "--ledger", nolog])[0]["passed"])
check("锚点人物名在标题里算“具体的人”",
      _qa.title_score("精卫填了一辈子海，原典里偏偏没写海填平了没有", names=["精卫"])
      > _qa.title_score("精卫填了一辈子海，原典里偏偏没写海填平了没有"))

fact = STORY.replace("这只鸟叫精卫。", "考古证实精卫真实存在。这只鸟叫精卫。")
rf1, _, _ = run(fact, extra=["--card", SC, "--ledger", nolog])
check("故事线把神话写成史实 → 扣合规并提示", any("写成了史实" in f for f in rf1["risk_flags"])
      and item(rf1, "compliance")["score"] < item(rs1, "compliance")["score"])
rf2, _, _ = run(fact, title="t", extra=["--driver", "信息型"])
check("资讯线不查神话史实化用语", not any("写成了史实" in f for f in rf2["risk_flags"]))
kin = STORY.replace("这只鸟叫精卫。", "我奶奶小时候讲过这只鸟。这只鸟叫精卫。")
check("故事线亲历口吻包装 → 提示",
      any("亲历口吻" in m for _, m in run(kin, extra=["--card", SC, "--ledger", nolog])[0]["card_checks"]))

def _cc(**kw):
    return [m for _, m in run(STORY, extra=["--card", _card(**{**STORY_CARD, **kw}), "--ledger", nolog])[0]["card_checks"]]
def _cf(**kw):
    return [m for lv, m in run(STORY, extra=["--card", _card(**{**STORY_CARD, **kw}), "--ledger", nolog])[0]["card_checks"] if lv == "fail"]
check("故事线缺母题、故事、所用版本 → 各自提示",
      all(any(k in m for m in _cc(母题="", 故事="", 所用版本=[])) for k in ["写母题", "写“故事”", "所用版本"]))
check("母题不在母题库 → 提示", any("不在母题库" in m for m in _cc(母题="外星人")))
check("内容线写错 → 立项卡不符", any("内容线" in m for m in _cf(内容线="小说线")))
check("故事线配了资讯线的主驱动 → 提示", any("确认内容线" in m for m in _cc(主驱动="信息型")))
check("开头式不在本线名单 → 提示", any("开头式写" in m for m in _cc(开头式="现场动作")))
check("没写主问题 → 提示", any("主问题" in m for m in _cc(主问题="")))
_ext = STORY_CARD["延伸"]
check("延伸接的问题和主问题一样 → 提示", any("是同一个" in m for m in _cc(主问题=_ext["接的问题"])))
check("延伸接法不在本线名单 → 提示", any("延伸接法" in m for m in _cc(延伸={**_ext, "接法": "下一步"})))
check("延伸出处为空 → 提示", any("延伸.出处" in m for m in _cc(延伸={**_ext, "出处": []})))
check("蓝图小标题和正文对不上 → 提示",
      any("蓝图" in m for m in _cc(蓝图=STORY_CARD["蓝图"] + [{"部分": "延伸", "小标题": "七、不存在的一节"}])))

print("== 19. 4.0.0：故事线台账撞题与旧台账兼容 ==")
import datetime as _dt
_today = _dt.date.today()
def _ago(n):
    return (_today - _dt.timedelta(days=n)).isoformat()
def _ledger(rows, fields=None):
    import csv as _csv
    pth = os.path.join(tmpd, f"lg{len(results)}.csv")
    fields = fields or _qa.LEDGER_FIELDS
    with open(pth, "w", encoding="utf-8-sig", newline="") as f:
        w = _csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", restval=""); w.writeheader(); w.writerows(rows)
    return pth
def _story_msgs(rows):
    return [m for _, m in run(STORY, extra=["--card", SC, "--ledger", _ledger(rows)])[0]["card_checks"]]
srow = dict(日期=_ago(5), 内容线="故事线", 体裁="长图文", 垂类="神话传说", 主驱动="故事型", 母题="徒劳与坚持",
            故事="精卫填海", 改编方式="原典重述", 开头式="原典一句", 结尾式="画面留白", 锚点人名="精卫", 主标题="旧的一篇", 状态="已交稿")
check("30 天内同一故事 → 撞题提示", any("同一故事撞题" in m for m in _story_msgs([srow])))
check("30 天内同一母题、不同故事 → 母题提示",
      any("母题" in m and "天内写过" in m for m in _story_msgs([{**srow, "故事": "愚公移山"}])))
check("超过 30 天的同一故事不提示", not any("撞题" in m or "天内写过" in m for m in _story_msgs([{**srow, "日期": _ago(40)}])))
check("连续两篇故事线同一改编方式 → 提示", any("连续两篇故事线" in m for m in _story_msgs([{**srow, "改编方式": "母题对照", "日期": _ago(40)}])))
check("开头式和故事线上一篇一样 → 提示", any("开头式和故事线上一篇一样" in m for m in _story_msgs([{**srow, "开头式": "定格画面", "日期": _ago(40)}])))
news_row = dict(日期=_today.isoformat(), 内容线="资讯线", 体裁="长图文", 垂类="神话传说", 主驱动="信息型",
                开头式="定格画面", 结尾式="两难选择", 锚点人名="精卫", 主标题="资讯一篇", 状态="已验收")
mm = _story_msgs([news_row])
check("故事线不拿资讯线那一篇比开头式、人名、同赛道", not any(("上一篇" in m or "撞脸" in m or "同赛道" in m) for m in mm), mm)
v3 = _ledger([dict(日期=_ago(3), 体裁="长图文", 垂类="神话传说", 主驱动="故事型", 开头式="定格画面", 结尾式="画面留白",
                   锚点人名="精卫", 主标题="三点一时代的故事稿", 状态="已交稿"),
              dict(日期=_ago(2), 体裁="长图文", 垂类="科技数码", 主驱动="信息型", 开头式="现场动作", 结尾式="帮亲友问计",
                   锚点人名="钟姐", 主标题="三点一时代的资讯稿", 状态="已验收")], fields=_qa.LEDGER_FIELDS_V3)
rv3, _, _ = run(STORY, extra=["--card", SC, "--ledger", v3])
check("旧台账（3.x 表头）照常读，主驱动故事型推断为故事线",
      any("开头式和故事线上一篇一样" in m for _, m in rv3["card_checks"]), rv3["card_checks"])
check("旧台账缺母题、故事列时不误报撞题", not any("撞题" in m or "天内写过" in m for _, m in rv3["card_checks"]))
pa = subprocess.run([sys.executable, LG, "add", "--card", SC, "--ledger", v3], capture_output=True, text=True)
import csv as _csv
_rows = list(_csv.DictReader(open(v3, encoding="utf-8-sig")))
check("ledger add 把旧台账升级成新表头、旧行保留", pa.returncode == 0 and list(_rows[0].keys()) == _qa.LEDGER_FIELDS
      and len(_rows) == 3 and _rows[0]["主标题"] == "三点一时代的故事稿", pa.stdout + pa.stderr)
check("升级时旧行补上推断的内容线", [r["内容线"] for r in _rows] == ["故事线", "资讯线", "故事线"], [r["内容线"] for r in _rows])
check("新行记下母题、故事、改编方式", _rows[-1]["母题"] == "徒劳与坚持" and _rows[-1]["故事"] == "精卫填海"
      and _rows[-1]["改编方式"] == "母题对照")
ps = subprocess.run([sys.executable, LG, "show", "--ledger", v3], capture_output=True, text=True)
check("ledger show 能读升级后的台账", ps.returncode == 0 and "精卫填海" in ps.stdout)
rself2, _, _ = run(STORY, extra=["--card", SC, "--ledger", v3])
check("故事线记账后复检不跟自己撞题", not any("撞题" in m for _, m in rself2["card_checks"]), rself2["card_checks"])

print("== 20. 4.0.0：规则源与文档一致性 ==")
_motif_md = _read(os.path.join("corpus", "story", "motifs.md"))
_heads = re.findall(r"^## (.+)$", _motif_md, flags=re.M)
check("母题库二级标题与 rules.MOTIFS 一一对应", _heads == _qa.MOTIFS, (_heads, _qa.MOTIFS))
check("母题库写明“动笔前须核实原典”", "动笔前须核实原典" in _motif_md)
check("母题库不放原文引号整段（不给可照抄的原文）", not re.search(r"“[^”]{30,}”", _motif_md))
check("每个内容线都有开头式、结尾式、延伸接法", all(k in _qa.OPENINGS and k in _qa.ENDINGS and k in _qa.EXT_WAYS for k in _qa.LINES))
check("故事线默认主驱动是故事型", _qa.LINES["故事线"]["default_driver"] == "故事型")
check("旧体裁名兼容（快图文、深图文 → short）", _qa.GENRE_MODE["快图文"] == _qa.GENRE_MODE["深图文"] == "short")
check("台账新字段齐全", all(k in _qa.LEDGER_FIELDS for k in ["内容线", "母题", "故事", "改编方式"]))
_pr = subprocess.run([sys.executable, QA, "--rules"], capture_output=True, text=True).stdout
check("--rules 输出内容线、母题、撞题窗口", "## 内容线" in _pr and "徒劳与坚持" in _pr and str(_qa.STORY_REPEAT_DAYS) in _pr)
check("brief.json 带 4.0.0 字段", all(k in _brief for k in ["内容线", "主问题", "延伸", "蓝图", "改编方式", "母题", "故事", "所用版本"])
      and all(k in _brief["延伸"] for k in ["起始小标题", "接的问题", "接法", "出处"]))
check("故事线夹具立项卡的枚举都合法", STORY_CARD["母题"] in _qa.MOTIFS and STORY_CARD["改编方式"] in _qa.ADAPT_WAYS
      and STORY_CARD["开头式"] in _qa.OPENINGS["故事线"] and STORY_CARD["结尾式"] in _qa.ENDINGS["故事线"])
_skill_paths = set(re.findall(r"`((?:references/|corpus/|templates/|scripts/|tests/)?[\w\-/一-龥]+\.(?:md|json|py))`", skill))
_missing_sp = sorted(p for p in _skill_paths if "NN-" not in p and "YYYY" not in p
                     and not any(os.path.exists(os.path.join(ROOT, d, p)) for d in ["", "references", "corpus", "templates", "scripts"])
                     and not p.startswith("outputs/")
                     and p not in ("立项卡.json", "log.csv", "feedback.md", "交稿单.md", "hot.json"))
check("SKILL.md 反引号里点名的文件都存在", not _missing_sp, _missing_sp)
_actual_refs = sorted(f for f in os.listdir(os.path.join(ROOT, "references")) if f.endswith(".md"))
check("references 目录里没有多余或缺失的文件", _actual_refs == sorted(expected_refs), _actual_refs)
check("每份 reference 都被 SKILL.md 路由", all(f in skill for f in _actual_refs), [f for f in _actual_refs if f not in skill])
check("corpus/story 两份都被 SKILL.md 点名", "corpus/story/motifs.md" in skill and "corpus/story/texture.md" in skill)
_big = {f: len(_read(os.path.join("references", f)).encode("utf-8")) for f in _actual_refs}
check("references 瘦身：单份 < 14KB", all(v < 14000 for v in _big.values()), _big)
check("SKILL.md 保留状态词和止步句", "——AI 到此止步。是否采用、何时发布由你决定。" in skill
      and all(w in skill for w in ["初稿待改", "待验收", "已验收", "验收退回", "已交稿"]))
_tpl = _read(os.path.join("templates", "交稿单-图文.md"))
check("交稿单默认长图文：标主稿、延伸字数和延伸接的问题", all(k in _tpl for k in ["主稿 [X] 字", "延伸 [X] 字", "延伸接的问题"]))
check("交稿单第九模块：首发四条与两项声明",
      all(k in _tpl for k in ["头条首发", "原创", "72 小时", "内容同步授权", "不重发", "扣 5 信用分", "14 天", "AI生成", "虚构演绎，故事经历", "2026-05-25"])
      and "声明原创”" not in _tpl.replace("没有单独的“声明原创”", ""))
check("交稿单保留止步句", "——AI 到此止步。是否采用、何时发布由你决定。" in _tpl)
check("s7 写明首发规则来源链接与日期", "https://baike.toutiao.com/detail/242/566/0" in docs["s7-delivery.md"]
      and "2026-05-25" in docs["s7-delivery.md"] and "2026-09-15" in docs["s7-delivery.md"] and "2025-11-27" in docs["s7-delivery.md"])
check("自定口径标了“本技能自定”", all("本技能自定" in docs[f] for f in ["s2-selection.md", "s4-story.md"]))
check("s4-story 写明平台边界与三种改编方式", "平台边界" in docs["s4-story.md"]
      and all(k in docs["s4-story.md"] for k in _qa.ADAPT_WAYS))
check("s4-common 写明三种接法两条线各三种", all(w in docs["s4-common.md"] for v in _qa.EXT_WAYS.values() for w in v))
check("s1 两个入口都在：热点雷达和节点日历", "热点雷达" in docs["s1-hot.md"] and "节点" in docs["s1-evergreen.md"])
_cl = _read("CHANGELOG.md")
check("CHANGELOG 记了 4.0.0（改了什么、为什么、删了什么）", "## 4.0.0" in _cl and "为什么" in _cl and "删" in _cl)

failed = [n for n, ok, _ in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} 通过")
if failed:
    print("未通过：")
    for n in failed:
        print("  -", n)
sys.exit(1 if failed else 0)
