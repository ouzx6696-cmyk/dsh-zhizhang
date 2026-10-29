#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""S1 热点雷达（toutiao-viral-writer 4.0.0）：并发拉取多平台热榜，归一化 → 跨平台共振合并 →
   按名次融合排序 → 红线过滤 → 垂类标注。
   脚本输出：融合分 score / 原始热度 heat / 来源与各榜名次 / 共振标记 / 垂类 / 趋势 trend。
   各平台热度口径不同（抖音上千万、百度几百万），不能直接比大小，所以排序用各榜名次融合：
   每上一个榜得 (51-名次)/50 分，多榜累加，共振条目自然靠前。
   未命中任何垂类的条目标为“未分类”。
   趋势：给 --compare 上一次的 JSON 快照，就按名次变化标 new/up/flat/down；
   没有快照时 trend 为空，在榜时长与趋势需人工判断（见 references/s1-hot.md）。
   全部失败时退出码 2，并提示使用搜索兜底或手动粘贴（见 SKILL.md）。
   用法：
     python fetch_hot.py                  # 默认 Top30
     python fetch_hot.py --top 50         # 多拉一些
     python fetch_hot.py --vertical 民生社保   # 只看某垂类
     python fetch_hot.py --relevant       # 只看命中 12 垂类的条目
     python fetch_hot.py --show-dropped   # 列出被红线丢弃的标题，核对误杀
     python fetch_hot.py --json hot.json  # 同时存 JSON 供 S2 复用
     python fetch_hot.py --json hot2.json --compare hot.json   # 和上次快照比，标出新上榜/上升/下降"""
import argparse, json, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# ---------------- 红线：命中即丢弃，不进选题池 ----------------
# 只做粗筛，宁可错杀：漏网的条目在 S2 由人工按 references/s1-hot.md 第三节再筛一遍。
BLOCKED = [
    # 伤亡与灾难
    "伤亡", "遇难", "罹难", "死亡", "身亡", "坠亡", "坠楼", "溺亡", "病亡", "去世", "离世", "遗体",
    "车祸", "爆炸", "火灾", "坍塌", "失联", "跳楼", "轻生", "自杀",
    # 刑案与司法
    "刺杀", "杀人", "凶手", "命案", "砍人", "持刀", "枪击", "逮捕", "被抓", "落网", "刑拘",
    "开庭", "宣判", "判刑", "死刑", "嫌疑人", "猥亵", "性侵", "拐卖",
    # 涉政涉军与外交
    "涉政", "军演", "军舰", "导弹", "战机", "解放军", "台海", "外交部", "巡视", "纪委", "监委",
    "落马", "双开", "被查", "党中央", "中共中央", "中央巡视", "中央纪委", "党", "总书记",
    "政治局", "国务院", "驻华大使", "制裁", "战争", "武装冲突", "停火", "空袭",
    "从严治党", "大选", "选举", "总统", "首相", "总理", "议员", "议会", "政党", "白宫", "北约",
    "台湾", "台独", "两岸", "韩国瑜", "赖清德", "国家秘密", "间谍", "窃密",
    # 未证实与疫情
    "确诊新增", "内幕", "辟谣", "网传", "疑似", "爆料", "知情人",
    # 明星私生活
    # 只拦明星八卦的典型说法；“离婚冷静期”“怀孕被辞退”这类民生题不在此列
    "官宣恋情", "官宣离婚", "恋情曝光", "出轨", "塌房", "热恋", "绯闻",
]

# ---------------- 垂类识别：标题命中即标注（S2 打分要用） ----------------
VERTICALS = [
    (r"养老金|退休|社保|公积金|医保|补贴|低保|抚恤|个人养老|灵活就业参保", "民生社保"),
    (r"招聘|裁员|失业|工资|薪资|加班|国考|省考|秋招|春招|35岁|灵活就业|骑手|外卖员|网约车|求职|社招", "职场就业"),
    (r"房价|楼市|公摊|房贷|物业|二手房|首付|学区房|租房|房租|业主|小区|交房|烂尾", "房产楼市"),
    (r"中考|高考|考研|课间|普高|分流|开学|教师|老师|校园|学生|家长|午托|补课|作业", "教育升学"),
    (r"养老院|护理|挂号|医院|独居|失能|慢病|体检|看病|医生|药价|集采|陪护|血脂|血压|血糖|胆固醇|癌|健康|养生|睡眠|医疗", "健康养老"),
    (r"农村|自建房|耕地|秋收|酒席|返乡|村规|种地|农民|粮价|村民", "三农乡土"),
    (r"彩礼|婚假|离婚|带娃|婆媳|相亲|生育|育儿|结婚|怀孕|父母", "情感家庭"),
    (r"利率|存款|理财|个税|银行|基金|保险|扣税|金价|黄金|涨价|降价|价格|倒挂|涨了|跌了|物价", "财经理财"),
    (r"新能源|油价|高速|充电|电动车|驾照|车险|驾车|开车|停车|高架|堵车|电瓶车", "汽车出行"),
    (r"AI|换脸|诈骗|手机|带货|直播|以旧换新|网购|退款|会员|App|APP|平台", "科技数码"),
    (r"菜价|供暖|摆摊|社区食堂|县城|夜市|公交|早餐|大爷|大妈|阿姨|老街|小摊|物价", "社会观察"),
    (r"旅游|景区|电影|宠物|文旅|门票|酒店|演出|假期|黄金周|出游|打卡", "文旅消费"),
]

def get(url, timeout=8, referer=None):
    headers = dict(UA)
    if referer: headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))

def to_int(v):
    """热度归一成 int。
    各平台口径不一：知乎 detail_text 形如 '1234 万热度'，百度 hotScore 有时是字符串。
    解析失败一律退回 0，绝不让非数字字符串流进后面 main() 里的 float() 排序把整个脚本打炸。"""
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip().replace(",", "").replace("，", "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*万", s)
    if m:
        return int(float(m.group(1)) * 10000)
    m = re.search(r"\d+", s)
    return int(m.group(0)) if m else 0

def clean(t):
    # 归一化：去空白、去话题井号、去【】标签
    return re.sub(r"\s+", " ", re.sub(r"[#【】]|^\S{0,4}快讯[：:]", "", (t or "").strip())).strip()

def toutiao():
    j = get("https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc")
    club = j.get("data") if isinstance(j, dict) else j
    if isinstance(club, dict): club = club.get("clubList", [])
    out = []
    for i, it in enumerate(club or [], 1):
        t = clean(it.get("Title"))
        if t: out.append({"rank": i, "title": t, "hot": to_int(it.get("HotValue")), "source": "头条热榜"})
    return out[:50]

def weibo():
    j = get("https://weibo.com/ajax/side/hotSearch", referer="https://weibo.com/")
    out = []
    for i, it in enumerate(j.get("data", {}).get("realtime", []) or [], 1):
        w = clean(it.get("word"))
        if w: out.append({"rank": i, "title": w, "hot": to_int(it.get("num")), "source": "微博热搜"})
    return out[:50]

def baidu():
    j = get("https://top.baidu.com/api/board?platform=wise&tab=realtime")
    out = []
    def walk(items):
        # 百度的 content 有时是平铺词条，有时多嵌一层 content（2026-10 实测为嵌套），两种都收
        for it in items or []:
            if isinstance(it, dict) and isinstance(it.get("content"), list):
                walk(it["content"])
            elif isinstance(it, dict):
                w = clean(it.get("word") or it.get("query"))
                if w and not it.get("isTop"):
                    out.append({"rank": len(out) + 1, "title": w,
                                "hot": to_int(it.get("hotScore")), "source": "百度热搜"})
    for card in j.get("data", {}).get("cards", []) or []:
        walk(card.get("content"))
    return out[:50]

def zhihu():
    j = get("https://www.zhihu.com/api/v4/topstory/hot-list?limit=50", referer="https://www.zhihu.com/hot")
    out = []
    for i, it in enumerate(j.get("data", []) or [], 1):
        t = clean((it.get("target") or {}).get("title", ""))
        if t: out.append({"rank": i, "title": t,
                          "hot": to_int(it.get("detail_text")), "source": "知乎热榜"})
    return out[:50]

def douyin():
    # 主接口常返回空包；iesdouyin 旧接口 2026-10 实测可用，作备用
    words = []
    for url in ("https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/",
                "https://www.douyin.com/aweme/v1/web/hot/search/list/"):
        try:
            j = get(url, referer="https://www.douyin.com/")
        except Exception:
            continue
        words = j.get("word_list") or (j.get("data", {}) or {}).get("word_list") or []
        if words: break
    out = []
    for i, it in enumerate(words, 1):
        w = clean(it.get("word", ""))
        if w: out.append({"rank": i, "title": w, "hot": to_int(it.get("hot_value")), "source": "抖音热点"})
    return out[:50]

SOURCES = [("toutiao", toutiao), ("weibo", weibo), ("baidu", baidu),
           ("zhihu", zhihu), ("douyin", douyin)]

def rank_points(rank):
    """名次融合：第 1 名 1.0 分，第 50 名 0.02 分，50 名以外 0 分。"""
    return round(max(0, 51 - int(rank)) / 50, 3)

def trend_of(key, rank, prev):
    """prev: {归一化标题: 上次名次}。上次没有 → new；名次前进 ≥3 → up；后退 ≥3 → down；否则 flat。"""
    old = prev.get(key)
    if old is None:
        for k, r in prev.items():
            if len(key) >= 8 and (key in k or k in key):
                old = r; break
    if old is None: return "new"
    if old - rank >= 3: return "up"
    if rank - old >= 3: return "down"
    return "flat"

def load_prev(path):
    try:
        rows = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"[warn] 读不到对比快照 {path}：{type(e).__name__}，趋势留空", file=sys.stderr)
        return None
    # 新快照存了全局名次 pos；旧快照只有 rank，退而求其次
    return {norm(r["title"]): r.get("pos", r.get("rank", 999)) for r in rows if isinstance(r, dict) and "title" in r}

def norm(t):
    return re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9]", "", t)

def vertical_of(title):
    for pat, v in VERTICALS:
        if re.search(pat, title): return v
    return "未分类"   # 不再把认不出的条目全塞进“社会观察”，免得 --vertical 社会观察 被噪音淹没

def is_risky(title):
    return next((b for b in BLOCKED if b in title), None)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--vertical", default="综合", choices=["综合"] + [v for _, v in VERTICALS] + ["未分类"])
    ap.add_argument("--compare", metavar="PREV_JSON", help="上一次 --json 存的快照，用来标趋势 new/up/flat/down")
    ap.add_argument("--json", metavar="PATH")
    ap.add_argument("--relevant", action="store_true", help="只保留命中 12 垂类的条目（丢掉“未分类”）")
    ap.add_argument("--show-dropped", action="store_true", help="列出被红线丢弃的标题，便于核对误杀")
    a = ap.parse_args()

    all_items, failed = [], []
    def safe(name_fn):
        name, fn = name_fn
        try:
            return name, fn()
        except Exception as e:
            print(f"[warn] {name} 抓取失败：{type(e).__name__}", file=sys.stderr)
            return name, None
    with ThreadPoolExecutor(max_workers=len(SOURCES)) as ex:
        for name, items in ex.map(safe, SOURCES):
            if items: all_items += items
            else: failed.append(name)

    if not all_items:
        print("全部信源抓取失败（可能被风控/无网络）。", file=sys.stderr)
        print("若环境支持搜索工具可自动改用搜索获取热点，或请用户手动粘贴今日热榜（任意一份 Top20）后继续 S2 选题提炼。", file=sys.stderr)
        sys.exit(2)

    # 跨平台共振合并：归一化后一致，或一方包含另一方（>=8字），合并来源
    merged = []
    for it in sorted(all_items, key=lambda x: (x["rank"], -to_int(x.get("hot")))):
        key = norm(it["title"])
        hit = None
        for m in merged:
            k = m["_key"]
            if key == k or (len(key) >= 8 and (key in k or k in key)):
                hit = m; break
        if hit:
            if it["source"] not in hit["sources"]:
                hit["sources"].append(it["source"])
                hit["ranks"][it["source"]] = it["rank"]
                hit["score"] += rank_points(it["rank"])
            hit["resonance"] = len(hit["sources"]) > 1
            hit["hot"] = max(hit["hot"], to_int(it.get("hot")))
        else:
            merged.append({**it, "sources": [it["source"]], "ranks": {it["source"]: it["rank"]},
                           "score": rank_points(it["rank"]), "_key": key, "resonance": False,
                           "hot": to_int(it.get("hot"))})
    merged.sort(key=lambda m: (-m["score"], -m["hot"]))

    # 红线过滤 + 垂类过滤
    kept, dropped_risky, dropped_list, pos = [], 0, [], 0
    for m in merged:
        risky = is_risky(m["title"])
        if risky:
            dropped_risky += 1
            dropped_list.append((m["title"], risky))
            continue
        pos += 1
        m["pos"] = pos          # 红线过滤后、垂类过滤前的全局名次，趋势按它比
        m["vertical"] = vertical_of(m["title"])
        if a.vertical != "综合" and m["vertical"] != a.vertical:
            continue
        if a.relevant and m["vertical"] == "未分类":
            continue
        kept.append(m)

    prev = load_prev(a.compare) if a.compare else None
    fetched_at = time.strftime("%Y-%m-%d %H:%M:%S %z")
    rows = []
    for i, m in enumerate(kept[:a.top]):
        rows.append({"rank": i + 1, "pos": m["pos"], "title": m["title"], "score": round(m["score"], 3), "heat": m["hot"],
                     "sources": m["sources"], "ranks": m["ranks"], "resonance": m["resonance"],
                     "vertical": m["vertical"],
                     "trend": trend_of(norm(m["title"]), m["pos"], prev) if prev is not None else "",
                     "fetched_at": fetched_at})

    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)

    print(f"抓取 {len(all_items)} 条，合并 {len(merged)} 条，红线丢弃 {dropped_risky} 条，"
          f"垂类“{a.vertical}”保留 {len(rows)} 条"
          + (f"（失败信源：{','.join(failed)}）" if failed else ""))
    print(f"{'#':<3}{'标题':<40}{'融合分':<8}{'来源':<16}{'垂类':<6}{'趋势'}")
    for r in rows:
        tag = " 🔥" if r["resonance"] else "  "
        print(f"{r['rank']:<3}{r['title'][:38]:<40}{r['score']:<8}"
              f"{'/'.join(r['sources'])[:14]:<16}{r['vertical']:<6}{r['trend'] or '-'}{tag}")
    if a.show_dropped and dropped_list:
        print("\n被红线丢弃（命中词）：")
        for t, w in dropped_list: print(f"  - {t}（{w}）")
    print("\n红线提醒：刑事案件细节 / 伤亡数字 / 未经证实传闻 / 涉政涉军 / 明星私生活 / 医疗断言 —— 一律不选。")
    print("只保留与普通人的钱包、饭碗、房子、孩子、身体有关的条目，带 🔥 的多平台共振条目优先。")
    if a.json: print(f"\n已存 {a.json}，S2 选题提炼可直接读这份清单打分。")

if __name__ == "__main__":
    main()
