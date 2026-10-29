#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""今日头条六维质检脚本（toutiao-viral-writer 4.0.0）。

用法：
  python3 qa_check.py 稿件.md --card 立项卡.json [--json]             # 推荐
  python3 qa_check.py 稿件.md --title "主标题" [--mode long|short|micro] [--line 资讯线|故事线]
                     [--driver 处境型] [--ext "延伸节第一个小标题"] [--json]
  python3 qa_check.py --rules                                         # 打印现行规则

  --mode long  ：长图文（默认体裁），正文 2600~3400 字 = 主稿约 2000 + 延伸节约 1000；用 --ext 或
                 立项卡“延伸.起始小标题”标出延伸从哪节开始，脚本分查两段字数，并查延伸节有没有重复主稿
  --mode short ：短图文，正文 1100~2200 字（3.x 的 quick/deep 仍可用，按 short 查）
  --mode micro ：微头条，正文 300~1000 字（经验值）；没有标题，首句当钩子打分，不要求小标题
  不给 --mode  ：只按 900~2600 的图文宽口径检查篇幅
  --line       ：内容线。故事线不给 --driver 时按故事型查；立项卡写了“内容线”就不用给

退出码：0=通过，1=打回，2=参数错误（缺标题、读不到文件或立项卡、没有正文）。
词表、权重、及格线、预算、内容线、母题都在 rules.py。
字数口径：去掉空白后的全部字符（含标点、数字、字母），配图行与【配图：…】标记不计。
分数是底线不是目标：过线后不要为了多拿分去堆口语词、数字或引号。
"""
import argparse, csv, datetime, json, math, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rules import *          # noqa: F401,F403  唯一规则源
import rules as R

def clamp(n):
    return max(0, min(100, round(n)))


def count(t, w):
    return len(re.findall(re.escape(w), t))


def cn_len(s):
    return len(re.sub(r"[^\u4e00-\u9fa5]", "", s))


def split_sents(text):
    return [s.strip() for s in SENT_SPLIT.split(text) if s and s.strip()]


def punct_issues(chunks):
    """返回 [(类别, 改法, 上下文片段)]，每类最多报 2 处。"""
    out = []
    for pat, label, fix in PUNCT_RULES:
        found = 0
        for c in chunks:
            for m in re.finditer(pat, c or ""):
                a, b = max(0, m.start() - 6), m.end() + 6
                out.append((label, fix, c[a:b].strip()))
                found += 1
                if found >= 2:
                    break
            if found >= 2:
                break
    return out


def load(path):
    """一级标题（# ）记为文章标题，不算小节；## 及以下才算小标题。
    图片行、【配图：…】标记记为配图，不算正文；分隔线跳过；引用块、列表、加粗标记去掉后按正文计。"""
    lines = open(path, encoding="utf-8").read().splitlines()
    title, headings, paras, images = "", [], [], 0
    load.hpos = []          # [(小标题, 它后面第一段在 paras 里的下标)]，长图文按它切主稿和延伸
    load.bold = sum(len(re.findall(r"\*\*|__|~~", ln)) // 2 for ln in lines)   # 粘到头条编辑器会原样露出来
    for ln in lines:
        # 加粗/删除线只是排版：不去掉会把“**先备份。**”这类加粗领句误判成段首重复和排比
        s = re.sub(r"\*\*|__|~~", "", ln).strip()
        if not s:
            continue
        if s.startswith("#"):
            h = s.lstrip("#").strip()
            if s.startswith("# ") and not title:
                title = h
            else:
                headings.append(h)
                load.hpos.append((h, len(paras)))
            continue
        if IMG_RE.match(s) or IMG_MARK_RE.match(s):
            images += 1
            continue
        if re.fullmatch(r"[-*_]{3,}", s):
            continue
        s = re.sub(r"^(>\s*)+", "", s)
        s = re.sub(r"^([-*+]|\d+[.、])\s+", "", s)
        if s:
            paras.append(s)
    return title, headings, paras, images


def title_score(t, micro=False, names=()):
    """标题力；micro 模式下 t 是首句，长度带改为 8~30 字。
    names：立项卡里的锚点人物名（钟姐、精卫、后羿……），出现在标题里和“老+姓”一样算具体的人。"""
    names = [n for n in names if n and len(n) >= 2]
    name_re = "|".join(re.escape(n) for n in names)
    hl = 55
    if micro:
        hl += 20 if 8 <= len(t) <= 30 else (10 if len(t) <= 45 else 0)
    else:
        hl += 20 if 18 <= len(t) <= 28 else (10 if len(t) >= 14 else 0)
    if re.search(NUM_T, t): hl += 6
    person = PERSON_T + ("|" + name_re if name_re else "")
    if re.search(person, t): hl += 8
    if re.search(HOOK_T, t): hl += 6
    if re.search(NUM_T + "|" + person + "|" + HOOK_T + HEAD8_EXTRA, t[:8]):
        hl += 5
    else:
        hl -= 6
    if re.search(r"[？！?!]", t): hl += 3
    if re.search(TITLE_BAN, t): hl -= 35
    return clamp(hl)


def norm_h(h):
    return re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9]", "", h or "")


def split_ext(paras, hpos, ext_start):
    """按延伸节起始小标题切开。找不到返回 None。"""
    key = norm_h(ext_start)
    if not key:
        return None
    for h, idx in hpos:
        nh = norm_h(h)
        if nh and (nh == key or key in nh or nh in key):
            return paras[:idx], paras[idx:]
    return None


def ext_overlap(main, ext, k=None):
    k = k or EXT_SHINGLE
    cm = re.sub(r"[^\u4e00-\u9fa5]", "", "".join(main))
    ce = re.sub(r"[^\u4e00-\u9fa5]", "", "".join(ext))
    if len(ce) < k:
        return 0.0
    gm = {cm[i:i + k] for i in range(len(cm) - k + 1)}
    ge = [ce[i:i + k] for i in range(len(ce) - k + 1)]
    return sum(1 for g in ge if g in gm) / len(ge)


def analyze(title, headings, paras, images, mode=None, driver=None, ext_start=None, hpos=None,
            line=None, names=()):
    mode = MODE_ALIAS.get(mode, mode)
    micro = mode == "micro"
    story = driver == "故事型" or line == "故事线"
    text = "\n".join(paras)
    scan = "\n".join([title] + headings + [text])     # 黑名单、合规、占位符、泄漏也扫标题和小标题
    chars = len(re.sub(r"\s", "", text))
    sents = split_sents(text)
    lens = [cn_len(s) for s in sents]
    avg = sum(lens) / len(lens) if lens else 0
    var = math.sqrt(sum((x - avg) ** 2 for x in lens) / len(lens)) if lens else 0

    # ---- 硬伤与通用信号
    unfilled = re.findall(r"\{[^{}\n]{1,10}\}", scan)[:5]
    pronoun_mix = sum(1 for p in paras
                      if "他" in PRONOUN_STRIP.sub("", p) and "她" in PRONOUN_STRIP.sub("", p))
    long_sents = [s for s in sents if cn_len(s) >= 6]      # “没。”“他没接话。”重复是节奏，不算重复句
    seen = {}
    for s in long_sents:
        seen[s] = seen.get(s, 0) + 1
    dup = sum(1 for v in seen.values() if v > 1)
    near = {}
    for s in long_sents:
        k = re.sub(r"[^\u4e00-\u9fa5]", "", s)[:12]
        if len(k) >= 8:
            near[k] = near.get(k, 0) + 1
    near_dup = sum(v - 1 for v in near.values() if v > 1)
    first2 = [p[:2] for p in paras]
    opener = sum(1 for i in range(1, len(first2)) if first2[i] == first2[i - 1])
    leak_hits = [(w, count(scan, w)) for w in IDENTITY_LEAK if count(scan, w) > 0]
    leak = sum(c for _, c in leak_hits)
    buzz = sum(count(scan, w) for w in BUZZ_WORDS)
    open_tpl = len(re.findall(OPEN_TPL, scan))
    empty_end = len(re.findall(EMPTY_END, scan))
    ladder = len(re.findall(r"不仅[^。，\n]{2,20}，而且", text))
    seesaw = len(re.findall(r"一方面[\s\S]{0,40}另一方面", text))
    n_along = count(scan, "随着")
    along = min(ALONG_CAP, n_along * ALONG_PEN)
    plen_raw = [len(p) for p in paras if len(p) > 12]
    if len(plen_raw) >= 3:
        pmean = sum(plen_raw) / len(plen_raw)
        pcv = (sum((x - pmean) ** 2 for x in plen_raw) / len(plen_raw)) ** 0.5 / pmean if pmean else 0
        uniform_pen = max(0, round((0.35 - min(pcv, 0.35)) * 60))   # 最多 -21
    else:
        pcv, uniform_pen = 0, 0
    hook_len = len(paras[0]) if paras else 0
    long_para = sum(1 for p in paras if len(p) > 150)

    # ---- 1 AI味
    traces = sorted(((w, count(scan, w)) for w in AI_WORDS if count(scan, w) > 0), key=lambda x: -x[1])
    hits = sum(c for _, c in traces)
    parallel = sum(1 for i in range(len(sents) - 2)
                   if sents[i][:2] == sents[i + 1][:2] == sents[i + 2][:2] and sents[i][:2])
    listing = 1 if re.search(r"(^|[。\n])(第[一二三四][，、]|一是|首先)", text) else 0
    markers = sum(count(text, m) for m in HUMAN_MARKERS) + len(PARTICLE_RE.findall(text))
    t1_found, t1_pen = [], 0
    for pat, label in T1_PATTERNS:
        n = len(re.findall(pat, text))
        if n:
            t1_found.append(f"{label}×{n}")
            t1_pen += n * 3
    t1_pen = min(12, t1_pen)
    t2_found, t2_pen = [], 0
    for w in T2_WORDS:
        cluster = sum(1 for p in paras if len(re.findall(re.escape(w), p)) >= 2)
        if cluster:
            t2_found.append(f"{w}×{cluster}段")
            t2_pen += cluster * 4
    ai = 78 - hits * 7 - parallel * 9 - pronoun_mix * 3 - dup * 6 - listing * 6 - t1_pen - t2_pen - leak * 25
    ai -= buzz * 4 + open_tpl * 8 + empty_end * 7 + ladder * 3 + seesaw * 6 + uniform_pen + along
    if hook_len > 100: ai -= 5
    if long_para: ai -= 5
    ai += min(11, var) + min(9, markers * 0.5)
    if unfilled: ai -= 45
    ai = clamp(ai)

    # ---- 2 可读性
    plens = [len(split_sents(p)) for p in paras]
    good = sum(1 for n in plens if 1 <= n <= 6) / max(1, len(plens))
    breaths = len(re.findall(r"—{1,2}|…{1,2}", text))          # 一处“——”或“……”算一次
    rd = 58 + (22 if 16 <= avg <= 32 else (8 if avg < 16 else -6))
    rd += good * 12 + min(6, breaths * 1.5) - opener * 5
    rd = clamp(rd)

    # ---- 3 标题力（micro：首句力）
    hook_line = split_sents(paras[0])[0] if paras else ""
    t = hook_line if micro else title
    hl = title_score(t, micro=micro, names=names)
    title_too_long = (not micro) and len(title) > 34

    # ---- 4 细节密度（数字只奖励到“够用”，超量反扣：账单味三信号）
    digits = len(re.findall(r"\d+(?:\.\d+)?", text))
    cn = len(re.findall(r"[一两二三四五六七八九十百千万亿]+(?=[块元趟次年月天岁张条])|[三四五六七八九]十[几多]?", text))
    quotes = len(re.findall(r"[““‘]", text))
    per1k = (digits + cn) / max(0.3, chars / 1000)
    dense_paras = sum(1 for p in paras if len(re.findall(NUM_RE, p)) >= 4)
    bill_per1k = len(re.findall(BILL_RE, text)) / max(0.3, chars / 1000)
    bill_pen = round(min(18, max(0, per1k - 15) * 1.2)
                     + min(12, max(0, dense_paras - 2) * 4)
                     + min(12, max(0, bill_per1k - 4) * 3))
    # 主驱动预算：给了 --driver 或立项卡才查
    n_numbers = digits + cn
    n_convert = len(re.findall(CONVERT_RE, text))
    budget = None
    driver_pen = 0
    if driver in DRIVERS:
        b = DRIVERS[driver]
        n_max = round(b["numbers"] * LONG_BUDGET_SCALE) if mode == "long" else b["numbers"]
        over_n = max(0, n_numbers - n_max)
        over_c = max(0, n_convert - b["convert"])
        over_d = max(0, dense_paras - b["dense"])
        driver_pen = min(12, over_n * 3) + over_c * 4 + over_d * 3
        budget = {"driver": driver, "numbers": n_numbers, "numbers_max": n_max,
                  "convert": n_convert, "convert_max": b["convert"],
                  "dense_paras": dense_paras, "dense_max": b["dense"], "penalty": driver_pen}
    num_credit = min(18, per1k * 3)
    if driver in LOW_NUMBER_DRIVERS:
        num_credit = max(num_credit, NUMBER_CREDIT_FLOOR)
    dt = clamp(50 + num_credit + min(14, quotes * 2.8) - bill_pen - driver_pen
               - dup * 9 - near_dup * 5 - (40 if unfilled else 0))

    # ---- 5 结构
    last_sents = len(split_sents(paras[-1])) if paras else 9
    has_interact = bool(re.search(INTERACT, text))
    if micro:
        st = 40 + min(12, images * 4)
        st += 6 if has_interact else 0
        st += 6 if 1 <= last_sents <= 3 else 0
        st += 4 if quotes >= 1 else 0
        st += 14 if len(paras) >= 4 else 0
        st += 18 if 300 <= chars <= 1000 else (8 if 150 <= chars <= 1500 else -10)
    else:
        st = 34 + min(24, len(headings) * 8) + min(12, images * 3)
        st += 6 if has_interact else 0
        st += 6 if 1 <= last_sents <= 3 else 0
        st += 4 if quotes >= 3 else 0
        st += 14 if chars >= 1400 else (12 if chars >= 1100 else (3 if chars >= 900 else -14))
    end_has_num = bool(paras) and bool(re.search(NUM_RE, paras[-1]))
    if end_has_num: st -= 4
    if unfilled: st -= 30
    st = clamp(st)

    # ---- 6 合规
    risk, cp = [], 100
    for pat, why in COMPLIANCE:
        if story and why == "未经证实信息":
            pat = r"内幕|独家爆料|知情人透露"      # 神话传说里“据传”“相传”是体裁用语
        m = re.search(pat, scan)
        if m:
            cp -= 11
            risk.append(f"“{m.group(0)}”命中{why}")
    if story:
        m = re.search(STORY_FACT_RE, scan)
        if m:
            cp -= 8
            risk.append(f"“{m.group(0)}”：把神话写成了史实。没有本次打开的出处就删掉，有出处就改成转述")
    if not micro:
        if chars < 900: cp -= 8; risk.append("全文不足900字，信息流权重会掉")
        cap = BANDS["long"][1] if mode == "long" else 2600
        if chars > cap: cp -= 5; risk.append(f"超过{cap}字，完读率风险上升")
    band = BANDS.get(mode)
    if band and not (band[0] <= chars <= band[1]):
        cp -= 4
        risk.append(f"{MODE_NAME[mode]}应为 {band[0]}~{band[1]} 字，现 {chars} 字")
    # ---- 长图文：主稿 + 延伸节
    ext_info, ext_gate = None, False
    if mode == "long":
        sp = split_ext(paras, hpos or [], ext_start)
        if not ext_start:
            risk.append("长图文没标延伸节从哪开始（--ext 或立项卡“延伸.起始小标题”），没法分查主稿和延伸")
        elif sp is None:
            cp -= 6
            risk.append(f"找不到延伸节起始小标题“{ext_start}”")
        else:
            mp, ep = sp
            mc = len(re.sub(r"\s", "", "".join(mp)))
            ec = len(re.sub(r"\s", "", "".join(ep)))
            ov = ext_overlap(mp, ep)
            ext_info = {"start": ext_start, "main_chars": mc, "ext_chars": ec, "overlap": round(ov, 2)}
            lo, hi = LONG_SPLIT["main"]
            if not lo <= mc <= hi:
                cp -= 4; risk.append(f"主稿应为 {lo}~{hi} 字，现 {mc} 字")
            lo, hi = LONG_SPLIT["ext"]
            if not lo <= ec <= hi:
                cp -= 4; risk.append(f"延伸节应为 {lo}~{hi} 字，现 {ec} 字")
            if ov >= EXT_OVERLAP_FAIL:
                ext_gate = True
                risk.append(f"延伸节有 {ov:.0%} 的片段和主稿重合：在重复主稿，不是延伸（平台判“事件重复描述”）")
            elif ov >= EXT_OVERLAP_WARN:
                cp -= 6
                risk.append(f"延伸节有 {ov:.0%} 的片段和主稿重合，删掉复述，只留新东西")
    if not has_interact: cp -= 5; risk.append("缺互动引导，评论率上不来")
    if unfilled: cp -= 30; risk.append(f"存在未替换占位符 {unfilled}，严禁发出")
    if leak: cp -= 40; risk.append(f"AI 身份泄漏 {'、'.join(w for w, _ in leak_hits)}，严禁发出")
    if near_dup: cp -= 6; risk.append(f"有 {near_dup} 组近似重复句（前12字相同）")
    if dup: cp -= 6; risk.append(f"有{dup}句在文中重复出现")
    if pronoun_mix: risk.append(f"{pronoun_mix}段同时出现“他”和“她”，人工核对指代是否错位")
    if end_has_num: risk.append("最后一段出现了数字：结尾要落在人、动作或一句话上")
    if budget and budget["penalty"]:
        risk.append(f"超出{driver}数字预算：数字{budget['numbers']}/{budget['numbers_max']}、"
                    f"换算{budget['convert']}/{budget['convert_max']}、堆数段{budget['dense_paras']}/{budget['dense_max']}")
    if title_too_long: cp -= 11; risk.append(f"标题 {len(title)} 字，超过平台 34 字硬上限，严禁发出")
    cp = clamp(cp)

    hints = []
    used = [n for n in SAMPLE_NAMES if n in scan]
    if used:
        hints.append(f"沿用了技能示例人名“{'、'.join(used[:3])}”：同账号篇篇同名会撞脸，建议给本篇的人另起名字")
    if t1_found:
        hints.append("句式信号只是线索，读着顺就留：" + "、".join(t1_found))

    scores = {"ai": ai, "read": rd, "title": hl, "detail": dt, "structure": st, "compliance": cp}
    overall = clamp(sum(scores[k] * WEIGHTS[k] for k in WEIGHTS))

    def mk(k, note):
        s, line = scores[k], PASS_LINE[k]
        status = "pass" if s >= line else ("warn" if s >= line - 10 else "fail")
        return {"key": k, "score": s, "status": status, "note": note}

    items = [
        mk("ai", f"机器腔{hits}处（{('、'.join(w for w, _ in traces[:3])) or '零命中'}）"
           + (f" · 句式信号[{'、'.join(t1_found[:3])}]" if t1_found else "")
           + (f" · 聚集[{'、'.join(t2_found[:3])}]" if t2_found else "")
           + f" · 句长方差{var:.1f} · 口语标记{markers}处"
           + (f" · 人称错位{pronoun_mix}段" if pronoun_mix else "")
           + (f" · 身份泄漏{leak}处" if leak else "")
           + (f" · 黑话{buzz}处" if buzz else "")
           + (f" · 万能开头{open_tpl}处" if open_tpl else "")
           + (f" · 空洞收尾{empty_end}处" if empty_end else "")
           + (f" · 裸“随着”{n_along}处(中性词,仅提示)" if n_along else "")
           + (f" · 段长均匀(机器排版){uniform_pen}" if uniform_pen else "")
           + (f" · 首段{hook_len}字" if hook_len > 100 else "")
           + (f" · 超长段{long_para}个" if long_para else "")),
        mk("read", f"平均句长{avg:.1f}字 · 段首重复{opener}处 · 破折号/省略号{breaths}处"),
        mk("title", (f"首句{len(t)}字" if micro else f"{len(t)}字")
           + ("" if re.search(NUM_T, t) else "，无数字（非必需）")
           + ("，超 34 字硬上限" if title_too_long else "")),
        mk("detail", f"每千字{per1k:.1f}个具体数值 · 直接引语{quotes}处"
           + (f" · 账单味-{bill_pen}（数字堆段{dense_paras}段 · 算账词每千字{bill_per1k:.1f}）" if bill_pen else "")
           + (f" · {driver}预算-{driver_pen}" if driver_pen else "")
           + (f" · 占位符残留{len(unfilled)}" if unfilled else "")),
        mk("structure", (f"{len(paras)}段 · {images}图" if micro else f"{len(headings)}个小节")
           + f" · 全文{chars}字"),
        mk("compliance", "；".join(risk[:2]) if risk else "未命中违禁词与绝对化用语"),
    ]
    # 文题承诺：标题里的阿拉伯数字正文必须接住
    title_nums = [] if micro else re.findall(r"\d+(?:\.\d+)?", title)
    missing_nums = [n for n in title_nums if n not in text]
    late_nums = [n for n in title_nums if n in text and n not in "\n".join(paras[:5])]
    if missing_nums: risk.append(f"标题里的数字 {'、'.join(missing_nums)} 正文没有出现")
    if late_nums: hints.append(f"标题数字 {'、'.join(late_nums)} 到第 5 段以后才出现，读者点进来要尽快接住")

    punct = punct_issues([title] + headings + paras)
    if getattr(load, "bold", 0):
        punct.append(("Markdown 加粗", "头条编辑器不认 **，粘进去会原样露出；要强调就在编辑器里加粗", f"{load.bold}处 **…**"))
    for label, fix, sample in punct[:6]:
        risk.append(f"非规范标点·{label}：在“{sample}”处（{fix}）")

    hard_gates = []
    if punct: hard_gates.append("非规范标点")
    if missing_nums: hard_gates.append("标题数字正文没接住")
    if unfilled: hard_gates.append("未替换占位符")
    if title_too_long: hard_gates.append("标题超34字")
    if leak: hard_gates.append("AI身份泄漏")
    if ext_gate: hard_gates.append("延伸节重复主稿")
    passed = overall >= 84 and not any(i["status"] == "fail" for i in items) and not hard_gates
    bad = "；".join(f'{i["key"]}{i["score"]}分' for i in items if i["status"] != "pass")
    if passed:
        verdict = f"综合{overall}分，过线，转人工验收。" + (f"还有{hits}处机器腔，建议再顺一遍。" if hits else "")
    else:
        verdict = (f"综合{overall}分，打回。"
                   + (f"触发硬闸：{'、'.join(hard_gates)}。" if hard_gates else "")
                   + (f"{bad}。" if bad else "")
                   + "回 S5 改具体句子和节奏，不要只换词、不要堆数字凑分。")
    return {"version": VERSION, "overall": overall, "passed": passed, "chars": chars,
            "mode": mode or "auto", "line": line or ("故事线" if driver == "故事型" else DEFAULT_LINE), "hard_gates": hard_gates, "extension": ext_info,
            "budget": budget,
            "bill_flavor": {"penalty": bill_pen, "numbers_per1k": round(per1k, 1),
                            "dense_paras": dense_paras, "bill_words_per1k": round(bill_per1k, 1)},
            "rhythm": {"avg_sent": round(avg, 1), "sent_std": round(var, 1),
                       "para_cv": round(pcv, 2), "hook_chars": hook_len},
            "items": items, "ai_traces": traces[:8], "t1": t1_found, "t2": t2_found,
            "risk_flags": risk, "hints": hints, "verdict": verdict,
            "title": t, "title_len": len(t)}


def load_card(path):
    try:
        return json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"读不到立项卡：{e}")
        sys.exit(2)


def read_ledger(path):
    if not path or not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [row for row in csv.DictReader(f)]


def _days_ago(row, today):
    try:
        return (today - datetime.date.fromisoformat(row.get("日期", ""))).days
    except ValueError:
        return None


def _as_list(v):
    if not v:
        return []
    return v if isinstance(v, list) else [v]


def check_card(card, paras, title, ledger_rows, today=None, headings=None):
    """立项卡 vs 成稿 vs 台账。返回 [(level, msg)]，level 为 fail / warn。"""
    out = []
    text = "\n".join(paras)
    line = R.line_of(card)
    if card.get("内容线") and card.get("内容线") not in LINES:
        out.append(("fail", f"立项卡内容线“{card.get('内容线')}”应为 {'/'.join(LINES)}"))
    drv = card.get("主驱动") or LINES[line]["default_driver"] or ""
    if drv not in DRIVERS:
        out.append(("fail", f"立项卡主驱动“{drv}”不在 {'/'.join(DRIVERS)} 里"))
    elif drv not in LINES[line]["drivers"]:
        out.append(("warn", f"{line}的主驱动一般是 {'/'.join(LINES[line]['drivers'])}，现在是“{drv}”，确认内容线没填错"))
    genre = card.get("体裁")
    if genre not in GENRE_MODE:
        out.append(("warn", f"立项卡体裁“{genre or ''}”应为 长图文/短图文/微头条"))
    elif genre in ("快图文", "深图文"):
        out.append(("warn", f"“{genre}”是 3.x 的体裁名，4.0.0 起统一叫“短图文”"))
    if not (card.get("主问题") or "").strip():
        out.append(("warn", "立项卡没写“主问题”：主稿要回答读者心里的哪一个问号，立项时就定下"))

    # ---- 长图文：主稿 + 延伸，立项时一起定
    if GENRE_MODE.get(genre) == "long":
        ext = card.get("延伸") or {}
        if not (ext.get("起始小标题") or "").strip():
            out.append(("fail", "长图文立项卡要写“延伸.起始小标题”"))
        if not (ext.get("接的问题") or "").strip():
            out.append(("fail", "长图文立项卡要写“延伸.接的问题”：延伸节接住主稿留下的哪个问题"))
        elif norm_h(ext.get("接的问题")) == norm_h(card.get("主问题")):
            out.append(("warn", "“延伸.接的问题”和“主问题”是同一个：延伸要接主稿之后冒出来的下一个问题"))
        way = (ext.get("接法") or "").strip()
        if way and way not in EXT_WAYS[line]:
            out.append(("warn", f"{line}的延伸接法写 {'/'.join(EXT_WAYS[line])} 之一，现在是“{way}”"))
        if not _as_list(ext.get("出处")):
            out.append(("warn", "“延伸.出处”为空：延伸节的新事实要单独核实、单独记出处"))
        hp = getattr(load, "hpos", [])
        if ext.get("起始小标题") and hp and split_ext(paras, hp, ext["起始小标题"]) is None:
            out.append(("fail", f"正文里找不到延伸节小标题“{ext['起始小标题']}”"))
        elif ext.get("起始小标题") and hp:
            _, ep = split_ext(paras, hp, ext["起始小标题"])
            nm = ((card.get("锚点人物") or {}).get("名字") or "").strip()
            if nm and nm not in "\n".join(ep):
                out.append(("warn", f"延伸节里“{nm}”没再出现：延伸要接着同一个人或同一个问题往下走"))
    # ---- 蓝图（可选）：立项时排好的小标题，成文要对得上
    bp = card.get("蓝图") or []
    if bp and headings is not None:
        hs = [norm_h(h) for h in headings]
        miss = [b.get("小标题", "") for b in bp if b.get("小标题")
                and not any(norm_h(b["小标题"]) in h or h in norm_h(b["小标题"]) for h in hs if h)]
        if miss:
            out.append(("warn", f"蓝图里的小标题正文没对上：{'、'.join(miss[:3])}。改了结构就回填立项卡"))

    # ---- 锚点人物
    anchor = card.get("锚点人物") or {}
    name = (anchor.get("名字") or "").strip()
    if not name:
        out.append(("warn", "立项卡没写锚点人物名字"))
    else:
        if name not in text:
            out.append(("fail", f"锚点人物“{name}”正文里没出现"))
        else:
            if name not in "\n".join(paras[:3]):
                out.append(("warn", f"“{name}”没在前三段入场"))
            if name not in "\n".join(paras[-3:]):
                out.append(("warn", f"“{name}”没贯穿到结尾，最后三段没再出现"))
        if name in SAMPLE_NAMES:
            out.append(("warn", f"“{name}”是技能示例人名，换一个本篇自己的名字"))
    if not anchor.get("真实案例"):
        m = re.search(FAKE_KIN_RE, text)
        if m:
            out.append(("fail", f"合成人物写成了作者亲历：“{m.group(0)}…”，改成明示口吻或换真实案例"))
        if line == "故事线":
            m = re.search(STORY_KIN_RE, text)
            if m:
                out.append(("warn", f"“{m.group(0)}”：没有真实经历就别用亲历口吻包装故事"))
    elif not anchor.get("来源"):
        out.append(("warn", "标了真实案例，但没写来源"))
    main = str(card.get("主数字") or "").strip()
    if main:
        if main not in text:
            out.append(("fail", f"主数字“{main}”正文里没出现"))
        if not card.get("主数字出处"):
            out.append(("warn", "主数字没写出处链接"))
    elif drv == "账本型":
        out.append(("warn", "账本型立项卡要写主数字"))
    if not card.get("出处"):
        out.append(("warn", "出处清单为空：政策、金额、日期、所用版本都要有链接或用户素材"))

    # ---- 故事线专有字段
    if line == "故事线":
        if card.get("改编方式") not in ADAPT_WAYS:
            out.append(("warn", f"故事线立项卡要写改编方式：{'/'.join(ADAPT_WAYS)}（见 s4-story.md）"))
        mt = (card.get("母题") or "").strip()
        if not mt:
            out.append(("warn", "故事线立项卡要写母题（见 corpus/story/motifs.md），台账靠它查撞题"))
        elif mt not in MOTIFS:
            out.append(("warn", f"母题“{mt}”不在母题库里（{'/'.join(MOTIFS)}）；新母题先补进 rules.py 和 corpus/story/motifs.md"))
        if not (card.get("故事") or "").strip():
            out.append(("warn", "故事线立项卡要写“故事”（如“精卫填海”），台账靠它查同一故事撞题"))
        if not _as_list(card.get("所用版本")):
            out.append(("warn", "故事线立项卡要写“所用版本”：书名加篇名或通行译本，动笔前核实原典"))

    op, ed = card.get("开头式", ""), card.get("结尾式", "")
    if op and op not in OPENINGS[line]:
        out.append(("warn", f"{line}的开头式写 {'/'.join(OPENINGS[line])} 之一，现在是“{op}”"))
    if ed and ed not in ENDINGS[line]:
        out.append(("warn", f"{line}的结尾式写 {'/'.join(ENDINGS[line])} 之一，现在是“{ed}”"))

    # ---- 台账。本篇已经记进台账时（S7 之后复检），别拿自己跟自己比
    me = {card.get("主标题", ""), title} - {""}
    ledger_rows = [r for r in ledger_rows if r.get("主标题") not in me]
    if not ledger_rows:
        return out
    today = today or datetime.date.today()
    same = [r for r in ledger_rows if R.line_of(r) == line]
    if same:
        last = same[-1]
        if op and last.get("开头式") == op:
            out.append(("warn", f"开头式和{line}上一篇一样（{op}），换一种"))
        if ed and last.get("结尾式") == ed:
            out.append(("warn", f"结尾式和{line}上一篇一样（{ed}），换一种"))
    if line == "资讯线":
        recent = [r.get("锚点人名", "") for r in ledger_rows[-10:]]
        if name and name in recent:
            out.append(("warn", f"“{name}”最近 10 篇里用过，撞脸"))
        day = today.isoformat()
        if any(r.get("日期") == day and r.get("垂类") == card.get("垂类") and R.line_of(r) == "资讯线"
               for r in ledger_rows):
            out.append(("warn", f"今天已经有一篇{card.get('垂类')}，同赛道同日互斥"))
    else:
        win = [r for r in same if (_days_ago(r, today) is not None and 0 <= _days_ago(r, today) < STORY_REPEAT_DAYS)]
        story_name = (card.get("故事") or "").strip()
        mt = (card.get("母题") or "").strip()
        if story_name and any((r.get("故事") or "").strip() == story_name for r in win):
            out.append(("warn", f"{STORY_REPEAT_DAYS} 天内写过“{story_name}”，同一故事撞题：换故事，或换一个读者没见过的版本和角度"))
        elif mt and any((r.get("母题") or "").strip() == mt for r in win):
            out.append(("warn", f"{STORY_REPEAT_DAYS} 天内写过“{mt}”母题，换一个母题或拉开改编方式"))
        way = card.get("改编方式")
        if way and same and (same[-1].get("改编方式") or "") == way:
            out.append(("warn", f"连续两篇故事线都是“{way}”，换一种改编方式"))
    week = []
    for r in ledger_rows:
        d = _days_ago(r, today)
        if d is not None and 0 <= d < 7:
            week.append(r.get("主驱动"))
    week.append(drv)
    if len(week) >= 3 and week.count("账本型") / len(week) > 0.5:
        out.append(("warn", f"近 7 天账本型 {week.count('账本型')}/{len(week)} 篇，超过一半"))
    return out


def rules_markdown():
    L = [f"# toutiao-viral-writer 现行规则 v{VERSION}", "",
         "由 scripts/rules.py 生成，文档里的数字以这里为准。凡平台没公布的口径，都是本技能自定。", "",
         "## 通过标准", f"- overall ≥ 84，六维零 fail（低于及格线 10 分以上），hard_gates 为空", "",
         "| 维度 | 权重 | 及格线 |", "|---|---|---|"]
    for k, w in WEIGHTS.items():
        L.append(f"| {k} | {w * 104:.0f}/104 | {PASS_LINE[k]} |")
    L += ["", "## 硬闸", "- 未替换 `{xx}` 占位符（扫标题、小标题、正文）", "- 标题超 34 字",
          "- 正文 AI 身份泄漏：" + "、".join(IDENTITY_LEAK),
          "- 标题里的阿拉伯数字正文没出现",
          "- 非规范标点：" + "、".join(l for _, l, _ in PUNCT_RULES),
          f"- 长图文：延伸节和主稿的 {EXT_SHINGLE} 字片段重合 ≥ {EXT_OVERLAP_FAIL:.0%}（≥ {EXT_OVERLAP_WARN:.0%} 扣 6 分）",
          "- 给了立项卡时：内容线或主驱动非法、锚点人物没出现、主数字没出现、合成人物写成作者亲历、"
          "长图文缺延伸字段或延伸小标题对不上", "",
          "## 内容线"]
    for k, v in LINES.items():
        L.append(f"- {k}：{v['desc']}。主驱动 {'/'.join(v['drivers'])}；开头式 {'、'.join(OPENINGS[k])}；"
                 f"结尾式 {'、'.join(ENDINGS[k])}；延伸接法 {'、'.join(EXT_WAYS[k])}")
    L += [f"- 故事线改编方式：{'、'.join(ADAPT_WAYS)}",
          f"- 故事线母题：{'、'.join(MOTIFS)}",
          f"- 故事线撞题窗口：{STORY_REPEAT_DAYS} 天内同一故事或同一母题提示；连续两篇同一改编方式提示",
          "- 故事线史实化用语（扣合规 8 分）：" + STORY_FACT_RE.replace("|", "、"), "",
          "## 篇幅档（经验值，档外只扣 4 分）"]
    for k, (lo, hi) in BANDS.items():
        L.append(f"- {k}（{MODE_NAME[k]}）：{lo}~{hi} 字")
    L.append(f"- 长图文内部：主稿 {LONG_SPLIT['main'][0]}~{LONG_SPLIT['main'][1]} 字，"
             f"延伸节 {LONG_SPLIT['ext'][0]}~{LONG_SPLIT['ext'][1]} 字（档外各扣 4 分）")
    L.append("- 别名：" + "、".join(f"{a}→{b}" for a, b in MODE_ALIAS.items()))
    L += ["", "## 主驱动数字预算（--driver 或立项卡）", "| 主驱动 | 数字上限 | 换算上限 | 堆数段上限 | 说明 |", "|---|---|---|---|---|"]
    for k, b in DRIVERS.items():
        L.append(f"| {k} | {b['numbers']} | {b['convert']} | {b['dense']} | {b['desc']} |")
    L += ["", f"长图文的数字上限乘 {LONG_BUDGET_SCALE}。超出：每多一个数字 -3（封顶 -12），每多一次换算 -4，每多一段堆数 -3，记在 detail。",
          "通用账单味三信号：每千字数字 >15、一段 ≥4 个数的段落 >2、算账词每千字 >4。",
          f"{'、'.join(LOW_NUMBER_DRIVERS)}不靠数字拿细节分：数字那一项至少给 {NUMBER_CREDIT_FLOOR} 分（本技能自定）。", "",
          "## 词表",
          "- 一级黑名单（-7/处）：" + "、".join(AI_WORDS),
          "- 行业黑话（-4/处）：" + "、".join(BUZZ_WORDS),
          "- 同段聚集（同段 ≥2 次 -4）：" + "、".join(T2_WORDS),
          "- 句式信号 T1（-3/处，封顶 -12）：" + "、".join(l for _, l in T1_PATTERNS),
          f"- 裸“随着”：-{ALONG_PEN}/处，封顶 -{ALONG_CAP}；模板“随着…的发展”-8",
          "- 口语标记（+0.5/处，封顶 +9）：" + "、".join(HUMAN_MARKERS) + "，句末语气词",
          "- 标题禁词（-35）：" + TITLE_BAN.replace("|", "、"),
          "- 合规（-11/类）：" + "、".join(sorted({w for _, w in COMPLIANCE})) + "（故事线不查“据传”“相传”）",
          "- 示例人名（只提示）：" + "、".join(SAMPLE_NAMES), "",
          "## 台账",
          "- 字段：" + ",".join(LEDGER_FIELDS),
          "- 3.x 旧台账（" + ",".join(LEDGER_FIELDS_V3) + "）照常读；缺“内容线”时主驱动是故事型算故事线，其余算资讯线；"
          "ledger.py 下次写入时补齐新表头"]
    return "\n".join(L)


def print_report(r):
    label = "首句" if r["mode"] == "micro" else "标题"
    print(f"====== 头条质检报告 v{r['version']} ======\n{label}：{r['title']}（{r['title_len']}字）\n"
          f"字数：{r['chars']} · 模式：{r['mode']} · 内容线：{r['line']}")
    for i in r["items"]:
        bar = "●" if i["status"] == "pass" else ("▲" if i["status"] == "warn" else "✖")
        print(f'[{bar}] {i["key"]:<10} {i["score"]:>3}  {i["status"]:<4} {i["note"]}')
    for w, c in r["ai_traces"][:5]:
        print(f"   AI痕迹：{w} ×{c}")
    if r["t2"]:
        print(f"   同段聚集：{'、'.join(r['t2'])}")
    b = r["bill_flavor"]
    if b["penalty"]:
        print(f"   账单味：数字每千字{b['numbers_per1k']}个、数字堆段{b['dense_paras']}段、"
              f"算账词每千字{b['bill_words_per1k']}——回看 s5-editing.md 病型 16，先查主驱动")
    e = r.get("extension")
    if e:
        print(f"   长图文：主稿{e['main_chars']}字 · 延伸节{e['ext_chars']}字（从“{e['start']}”起） · 与主稿重合{e['overlap']:.0%}")
    for f in r["risk_flags"][2:]:
        print(f"   风险：{f}")
    for h in r["hints"]:
        print(f"   提示：{h}")
    for lv, msg in r.get("card_checks", []):
        print(f"   立项卡{'✖' if lv == 'fail' else '▲'}：{msg}")
    if r["hard_gates"]:
        print(f"   一票否决：{'、'.join(r['hard_gates'])}")
    print(f"—— 综合 {r['overall']} → {'通过，转人工验收' if r['passed'] else '打回'}")
    print(r["verdict"])


def main():
    ap = argparse.ArgumentParser(description="今日头条六维质检")
    ap.add_argument("file", nargs="?")
    ap.add_argument("--title", default="")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--mode", choices=list(BANDS) + list(MODE_ALIAS),
                    help="long=长图文（主稿+延伸，默认体裁），short=短图文，micro=微头条（无标题）；quick/deep 按 short 查")
    ap.add_argument("--line", choices=list(LINES), help="内容线：资讯线 / 故事线（立项卡写了就不用给）")
    ap.add_argument("--ext", default="", help="长图文延伸节的第一个小标题（立项卡写了就不用给）")
    ap.add_argument("--driver", choices=list(DRIVERS), help="按主驱动查数字预算")
    ap.add_argument("--card", metavar="立项卡.json", help="立项卡：自动带出内容线、体裁、主驱动、标题，并核对人物、主数字、台账")
    ap.add_argument("--ledger", metavar="log.csv", default="outputs/toutiao/log.csv",
                    help="发稿台账，默认 outputs/toutiao/log.csv（不存在就跳过）")
    ap.add_argument("--rules", action="store_true", help="打印现行规则（Markdown）后退出")
    ap.add_argument("--version", action="version", version=VERSION)
    a = ap.parse_args()
    if a.rules:
        print(rules_markdown())
        sys.exit(0)
    if not a.file:
        ap.error("需要稿件路径")
    card = load_card(a.card) if a.card else None
    mode, driver, line = a.mode, a.driver, a.line
    if card:
        line = line or R.line_of(card)
        mode = mode or GENRE_MODE.get(card.get("体裁"))
        driver = driver or (card.get("主驱动") if card.get("主驱动") in DRIVERS else None)
    if line and not driver:
        driver = LINES[line]["default_driver"]
    if driver == "故事型" and not line:
        line = "故事线"
    mode = MODE_ALIAS.get(mode, mode)
    try:
        title, headings, paras, images = load(a.file)
    except OSError as e:
        print(f"读不到稿件：{e}")
        sys.exit(2)
    t = (a.title or title or (card or {}).get("主标题", "")).strip().strip("《》“”\"“”")
    if not paras:
        print("稿件没有正文段落")
        sys.exit(2)
    if not t and mode != "micro":
        print("缺少标题（--title、文内 # 一级标题或立项卡主标题）；微头条请加 --mode micro")
        sys.exit(2)
    ext_start = a.ext or ((card or {}).get("延伸") or {}).get("起始小标题", "")
    names = [((card or {}).get("锚点人物") or {}).get("名字", "")]
    r = analyze(t, headings, paras, images, mode, driver, ext_start, getattr(load, "hpos", []),
                line=line, names=names)
    if card:
        cc = check_card(card, paras, t, read_ledger(a.ledger), headings=headings)
        r["card_checks"] = cc
        fails = [m for lv, m in cc if lv == "fail"]
        if fails:
            r["hard_gates"].append("立项卡不符")
            r["passed"] = False
            r["verdict"] = f"综合{r['overall']}分，打回。立项卡不符：{'；'.join(fails)}。"
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print_report(r)
    sys.exit(0 if r["passed"] else 1)


if __name__ == "__main__":
    main()
