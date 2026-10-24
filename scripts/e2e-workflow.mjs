/**
 * dsh-zhizhang 端到端工作流验收 — 不是工程冒烟，是一条真实创作剧本走完闭环。
 *
 *   npm run e2e        (or: node scripts/e2e-workflow.mjs)
 *
 * 剧本（一个连续故事，全部走 dist，即 DSH 实际加载的产物）：
 *   启用 → 拆一本参考书（import→plan→dissect→facts→structure→卡→报告→组包）
 *   → 灵感长出自己的作品（会话→forge→根基/章纲 apply，bindings 落盘）
 *   → 写第一章（lean brief→初稿→闸门三连拒→lint→采纳→兑付审计→审校留痕→定稿）
 *   → 写第二章（续写 brief 注入前章全文→面板 HTTP 采纳）
 *   → 汇编成稿 → 外部架构盘点（磁盘树 / 项目索引 / 面板快照上界）。
 * 每步断言两件事：操作真实落盘 + 回执给 AI 指出下一步。
 */
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const root = await mkdtemp(path.join(tmpdir(), "zz-e2e-"));
delete process.env.DSH_ZHIZHANG_ROOT;
process.env.DSH_HOME = path.join(root, ".dsh");

const ZZ = path.join(root, ".zhizhang");
let stepNo = 0;
let stepStart = Date.now();
function step(name, note = "") {
  stepNo += 1;
  const ms = (Date.now() - stepStart).toString().padStart(4, " ");
  stepStart = Date.now();
  console.log(`  ✓ [${String(stepNo).padStart(2, "0")}] ${name}${note ? ` — ${note}` : ""} (${ms}ms)`);
}

try {
  // ============================== 启用 ==============================
  const plugin = await import(pathToFileURL(path.join(pkgRoot, "dist/index.js")).href);
  const mounted = [];
  const sections = [];
  const agentCtx = {
    tools: { register: (t) => mounted.push(t) },
    get: () => ({ section: (s) => { sections.push(s); return () => {}; } }),
  };
  const exec = { agent: { ctx: agentCtx, session: { id: "e2e", header: { cwd: root } } } };
  const shell = [];
  plugin.apply({ tools: { register: (t) => shell.push(t) }, get: agentCtx.get }, {});
  let out = await shell[0].execute({}, exec);
  assert.match(out, /已启用织章/);
  assert.equal(mounted.length, plugin.__testing.tools.length, "trigger must mount all tools");
  assert.ok(sections.length >= 1 && /织章/.test(sections[0].text()), "SYSTEM_BRIEF section mounted");
  const byName = new Map(mounted.map((t) => [t.name, t]));
  const run = (name, args = {}) => byName.get(name).execute(args, exec);
  step("zhizhang_enable", `${plugin.__testing.tools.length} tools + SYSTEM_BRIEF 挂载`);

  // ============================== 拆书 · 交一本参考书 ==============================
  // 《夜班账本》：10 章短篇参考书。措辞故意带 ending 词汇表锚点（侧窗/回放/时间戳/屏幕/刷卡），
  // 让后续技法卡证据与本书章末兑付都在同一套语汇里。
  const chapters = [
    ["第1章 差三罐", "凌晨两点，周砚把最后一排货架数完，屏幕上的数字比昨天少了三罐咖啡。他把时间戳抄在纸条上，塞进围裙口袋。门铃响了，常客老蒋进来，刷卡买了一罐最贵的，没抬头。"],
    ["第2章 四秒", "交接班前，周砚调出监控回放。画面里侧窗的位置闪过一个人影，全程只用了四秒。他把画面停在那一帧：人影的手上戴着店里的一次性手套。"],
    ["第3章 手套", "手套在货架底层，包装完好，数目不少一盒。周砚数了三遍，数到第三遍的时候，收银机的屏幕自己亮了一下，又灭了。"],
    ["第4章 老蒋", "老蒋第二天又来，还是刷卡，还是不抬头。周砚把小票留下，时间戳对了两遍，对不上。他没有问，只是把小票钉在了值班本上。"],
    ["第5章 值班本", "值班本往前翻三年，每年三月都有一页写着同样的话：差货，查无。字迹不是一个人的。周砚把那一页拍了照。"],
    ["第6章 交接", "白班的陈姐看见照片，只说了一句：三月别数太细。她说完就去补货了，侧窗的光落在她背上，她没有回头。"],
    ["第7章 三月", "周砚把三年的小票按月排开。三月的刷卡记录都集中在凌晨两点到三点之间，卡号是同一张。他把那张卡的签名条放大——签的是店里的旧店名。"],
    ["第8章 旧店名", "旧店名七年前就改了。能用旧店名签单的，只有当年接过班的人。周砚在员工墙的照片前站了很久，墙上少了一个人形的钉子印。"],
    ["第9章 钉子印", "少的那张照片压在仓库的玻璃板下面。照片背面写着一行小字：差货不是贼，是记账的人。周砚把照片翻过来又翻回去。"],
    ["第10章 记账的人", "月底盘库，数字第一次平了。周砚把纸条、小票、照片装进一个信封，写上「三月，勿拆」。他把信封锁进货架底层的抽屉，关灯，走人。侧窗外面，雨开始下。"],
  ];
  const book = chapters.map(([h, b]) => `${h}\n　　${b}`).join("\n");
  out = await run("zhizhang_library_import", { title: "夜班账本", text: book });
  const srcId = /sourceId=(src-[a-z0-9]+)/.exec(out)?.[1];
  assert.ok(srcId, "import must return sourceId");
  assert.match(out, /下一步 2\/9/, "import receipt must point to library_plan");
  step("zhizhang_library_import", `《夜班账本》10 章 → ${srcId}`);

  // —— 抽样计划（Auto；小书全读）——
  out = await run("zhizhang_library_plan", { source: srcId });
  assert.match(out, /已生成抽样计划/);
  assert.match(out, /全读（小书）/, "small book plans to full-read under Auto");
  assert.match(out, /下一步 3\/9/);
  step("zhizhang_library_plan", "Auto · 小书全读");

  // —— Full 负例：有 Auto 计划时 mode=full 不生效，回执须指明升级全量的正路 ——
  out = await run("zhizhang_library_dissect_brief", { source: srcId, mode: "full" });
  assert.match(out, /已有计划/, "plan status receipt");
  assert.match(out, /不会在这里生效|作者同意/, "mode=full under a non-full plan must be redirected, not silently ignored");
  step("dissect(mode=full) 负例", "回执指路：全量须 plan 同意");

  // —— 取批原文 ——
  out = await run("zhizhang_library_dissect_brief", { source: srcId, batch: 0 });
  assert.match(out, /第1章/);
  assert.match(out, /下一步 4\/9/);
  step("zhizhang_library_dissect_brief", "batch 0 · 第1章起");

  // —— 白描事实（证据引用必须是原文）——
  out = await run("zhizhang_library_facts_stage", {
    source: srcId,
    facts: {
      n: 1,
      title: "差三罐",
      events: [{ desc: "周砚盘点发现咖啡少三罐，把时间戳抄下", quote: "屏幕上的数字比昨天少了三罐咖啡" }],
      hook: { type: "悬念", text: "少的三罐去了哪", strength: "强" },
      value: { situation: "独自夜班盘点" },
      unknowns: ["谁拿走了咖啡", "为什么是三月"],
    },
  });
  assert.match(out, /已记录 1 章事实/);
  step("zhizhang_library_facts_stage", "第 1 章白描落盘");

  // —— 结构聚合 ——
  out = await run("zhizhang_library_structure_stage", {
    source: srcId,
    kind: "plot",
    payload: {
      title: "差货追查",
      chapters: [1, 10],
      goal: "查清三月差货的来历",
      obstacle: "知情人不说",
      action: "对小票、翻值班本、找旧照片",
      result: "差货源于记账习惯而非偷窃",
      twist: "照片背面一行小字",
      turn: "不再追人，改记账",
    },
  });
  assert.match(out, /已记录剧情条/);
  out = await run("zhizhang_library_structure_stage", {
    source: srcId,
    kind: "character",
    payload: {
      name: "周砚",
      role: "主角",
      mask: "较真的夜班店员",
      truth: "他要的不是贼，是平账",
      arc: [{ chapter: 10, from: "追查", to: "封存", pressure: "真相只是记账习惯" }],
      function: "视角",
    },
  });
  assert.match(out, /已记录人物/);
  step("zhizhang_library_structure_stage", "plot + character");

  // —— 技法卡（v2 craft：人味+书感字段齐全，证据可回溯）——
  out = await run("zhizhang_library_card_stage", {
    title: "数字先于情绪",
    source: srcId,
    axis: "craft",
    layer: "scene",
    dimension: "hook",
    body: "把异常写成一次可核对的数数动作，情绪跟着数字走，不抢在数字前面。",
    mechanisms: [{ name: "差数即钩子", experience: "盘点差三罐开场", rebuild: "换成任何可核对的数字差", discard: "夜班便利店设定", failWhen: "差数只是气氛道具" }],
    humanFeel: {
      writerCraft: "让人物先重数一遍再开口",
      craftRange: "近景柜台",
      characterState: "第一反应是核对而不是惊讶",
      stateOnPage: "停半拍，先报数",
      allowedEdges: "可插一句店内噪音",
      failAsTemplate: "句句报数即失败",
    },
    bookCraft: {
      continueWhy: "想知道差数背后的账",
      adjacentChange: "下一章换排查对象",
      failAsShortStory: "一章破案即失败",
    },
    readerWant: "想知道差数背后的账",
    emotionArc: "平静-起疑-确认",
    dramaticUnit: "一次对不上的盘点",
    replaceables: ["三罐咖啡", "便利店", "夜班"],
    mustNotCopy: ["周砚", "夜班账本"],
    evidence: [{ quote: "屏幕上的数字比昨天少了三罐咖啡", chapter: 1 }],
    steps: ["先让差数出现在具体动作里", "再让人物当场核对一遍", "情绪只落在核对之后"],
    bannedDiction: ["心中一沉"],
    transfer: "换成实验室试剂用量、仓库料差均可",
    failWhen: "把差数解释成超自然",
  });
  const craftCand = /lcand-[a-z0-9]+/.exec(out)?.[0];
  assert.ok(craftCand, "card_stage must return lcand-…");
  out = await run("zhizhang_library_card_accept", { candidate: craftCand });
  const craftCard = /card-[a-z0-9]+/.exec(out)?.[0];
  assert.ok(craftCard, "card_accept must return cardId");
  step("技法卡 craft", "数字先于情绪 → 已采纳");

  // —— 思维卡（v2 mind：组包必需）——
  out = await run("zhizhang_library_card_stage", {
    title: "小数字撬大怀疑",
    source: srcId,
    axis: "mind",
    layer: "arc",
    dimension: "commercial",
    body: "卖点不靠大事件，靠一个对不上的小数字：让读者跟着人物核对，怀疑自己长出来。",
    mechanisms: [{ name: "可核对的小异常", experience: "三罐咖啡", rebuild: "任何日常账目差", discard: "便利店职业名词", failWhen: "异常无法核对" }],
    mind: {
      sellIntoCost: "追差货要占用睡眠、得罪同事",
      infoStaging: "线索分三月慢慢漏",
      pressureMachine: "知情人一句劝退一层",
      debtAndSwap: "章末留一个新差数换下一章追查",
      readerContract: "进场就给一个对不上的数",
      failAsEncyclopedia: "设定集中解释差货原理即失败",
    },
    readerWant: "想跟着核对那笔对不上的账",
    emotionArc: "笃定-动摇-重估",
    dramaticUnit: "一笔对不上的小账撬开旧事",
    replaceables: ["盘点差数", "便利店", "值班本"],
    mustNotCopy: ["周砚", "三月差货"],
    evidence: [{ quote: "他把时间戳抄在纸条上，塞进围裙口袋", chapter: 1 }],
    transfer: "会计对账、实验记录均可迁移",
    failWhen: "异常一次讲透",
  });
  const mindCand = /lcand-[a-z0-9]+/.exec(out)?.[0];
  out = await run("zhizhang_library_card_accept", { candidate: mindCand });
  const mindCard = /card-[a-z0-9]+/.exec(out)?.[0];
  assert.ok(mindCard && craftCard);
  step("思维卡 mind", "小数字撬大怀疑 → 已采纳");

  // —— 卡的读取面（steps / 禁用词句要真到达 AI）——
  out = await run("zhizhang_library_card_get", { card: craftCard });
  assert.match(out, /操作步骤：/);
  assert.match(out, /先让差数出现在具体动作里/);
  assert.match(out, /禁用词句：心中一沉/);
  step("zhizhang_library_card_get", "steps + 禁用词句 可读");

  // —— 报告（19 节落盘）——
  out = await run("zhizhang_library_report", { source: srcId });
  assert.match(out, /报告已写入/);
  const reportMd = await readFile(path.join(ZZ, "library", "analyses", srcId, "report.md"), "utf8");
  assert.equal((reportMd.match(/^## \d+\./gm) ?? []).length, 19, "report must have 19 sections");
  step("zhizhang_library_report", "19 节报告落盘");

  // —— 组包（1 book + N scene）——
  out = await run("zhizhang_library_combo_suggest", {});
  assert.match(out, /组合包/);
  const cardIds = [...out.matchAll(/card-[a-z0-9]+/g)].map((m) => m[0]);
  assert.ok(cardIds.includes(mindCard) && cardIds.includes(craftCard), "combo must include both cards");
  assert.match(out, /zhizhang_inspire_start/);
  step("zhizhang_library_combo_suggest", `1 mind + ${cardIds.length - 1} craft`);

  // ============================== 灵感 · 长出自己的作品 ==============================
  out = await run("zhizhang_inspire_start", {
    goal: "夜班店员追查货差，最后发现要对的是自己的记账习惯",
    genre: "都市职场",
    card_ids: cardIds,
  });
  assert.match(out, /灵感会话已开/);
  const sessionId = /灵感会话已开：([A-Za-z0-9-]+)/.exec(out)?.[1];
  assert.ok(sessionId);

  out = await run("zhizhang_inspire_forge_brief", { session: sessionId });
  assert.match(out, /mind · 主粮/, "forge must feed mind primary");
  assert.match(out, /数字先于情绪/, "forge must carry craft cue");
  step("inspire_start + forge_brief", "mind 主粮 + craft 提示");

  // 根基候选 → apply 建作品
  out = await run("zhizhang_inspire_stage", {
    session: sessionId,
    kind: "foundation",
    payload: {
      locks: "不出现超自然；差货必须有现实解释",
      characters: "何菱：夜班店员，数到第三遍才肯说话",
      planned: "三章内给出差货的第一层解释",
      style: "克制、器物细节、限知",
      threads: "监控里戴手套的人影",
    },
  });
  const fCand = /icand-[a-z0-9]+/.exec(out)?.[0];
  assert.ok(fCand, "inspire_stage must return icand-…");
  out = await run("zhizhang_inspire_accept", {
    candidate: fCand,
    work: "凌晨账本",
    apply: true,
    title: "凌晨账本",
    genre: "都市职场",
    premise: "一个只信数字的夜班店员，被一笔对不上的账改变",
  });
  assert.match(out, /已 apply foundation/);
  step("inspire foundation apply", "作品《凌晨账本》建立（根基落盘）");

  // 章纲候选 → apply（ending 带词汇表锚点：侧窗/屏幕/时钟）
  out = await run("zhizhang_inspire_stage", {
    session: sessionId,
    kind: "outline",
    payload: {
      chapter: "c001",
      title: "少一箱",
      ending: "何菱把侧窗的锁扣死，屏幕停在 02:10。",
      situationLens: "盘完货对不上数的焦虑",
      livedScene: "第一次独自调监控回放",
      stateLens: "冷、在算数",
      targetWords: 800,
    },
  });
  const oCand = /icand-[a-z0-9]+/.exec(out)?.[0];
  out = await run("zhizhang_inspire_accept", { candidate: oCand, work: "凌晨账本", apply: true });
  assert.match(out, /已 apply outline/);
  const bindings = JSON.parse(await readFile(path.join(ZZ, "inspiration", "bindings.json"), "utf8"));
  assert.ok(
    (bindings["凌晨账本"] ?? []).some((id) => id === craftCard),
    "bindings.json must index the work's bound cards",
  );
  step("inspire outline apply", "c001 章纲落盘 · bindings 索引建立");

  // ============================== 写作 · 第一章从简报到定稿 ==============================
  out = await run("zhizhang_chapter_brief", { chapter: "c001" });
  assert.match(out, /## 本书读者合同/, "brief must open with the reader contract");
  assert.match(out, /开篇写法/, "first chapter brief must carry the opening contract line");
  assert.match(out, /数字先于情绪/, "brief must inject the bound craft card (via bindings)");
  assert.match(out, /style_contract/, "lean brief must carry the style contract");
  assert.match(out, /candidate_stage/, "brief must point at the delivery chain");
  step("zhizhang_chapter_brief(lean)", "读者合同 + 绑定卡 + 文风契约");

  // 初稿：兑现章纲 ending（侧窗/屏幕/02:10 都在正文里落位）
  const body1 = [
    "冻柜的嗡声比人先到。何菱推着计数器从东头数到西头，第三遍的数字停在同一格：奶咖少一箱，整箱。",
    "她把小票的时间戳抄在掌心，又对着屏幕核了一遍。屏幕不发表意见，只把凌晨的钟往前推了一分钟。",
    "交接本上白班的字很草：奶咖补过。何菱没划掉那行字，只是把本子转了个方向，让那行字对着监控探头。",
    "回放从两点整开始。画面里的侧窗先是黑的，第七分钟亮了一线，像有人贴着窗缝站过。何菱把那一帧停住，凑近：玻璃上有半枚手套印，指节的位置很正，不是慌张的人留的。",
    "手套在货架底层，她数了一遍，不少。她再数冻柜，奶咖那格空出来的位置摆着一张对折的小票，票面朝下。",
    "她没有立刻去翻。她先把这一格的货推齐，把计数器归零，才用两根手指把小票翻过来——是昨天的批次，签字栏里是店里的旧店名，七年前的那个。",
    "门铃没有响。侧窗外的雨把路灯泡开成一团。何菱把侧窗的锁扣死，屏幕停在 02:10。",
  ].join("\n\n");
  out = await run("zhizhang_candidate_stage", { chapter: "c001", content: body1, draft_label: "初稿" });
  const cand1 = /cand-[a-z0-9]+/.exec(out)?.[0];
  assert.ok(cand1, "candidate_stage must return cand-…");

  // 闸门负例：没 lint 直接 accept → 硬拒（工具路径：显式调用即授权，confirm 属面板人工路径）
  out = await run("zhizhang_candidate_accept", { candidate: cand1 });
  assert.match(out, /lint_required/, "accept before lint must be refused");
  out = await run("zhizhang_style_lint", { candidate: cand1 });
  assert.match(out, /lintPassToken：lint-/);
  step("candidate_stage + 闸门负例", "无 lint 拒（lint → token）");

  // 正式采纳（brief 留痕 + lint token 双闸已过）
  out = await run("zhizhang_candidate_accept", { candidate: cand1 });
  assert.match(out, /已采纳/);
  assert.match(out, /payoff_missing/, "accept must note the absent payoff audit (soft)");
  const c001File = path.join(ZZ, "works", "凌晨账本", "chapters", "c001.md");
  const saved1 = await readFile(c001File, "utf8");
  assert.ok(saved1.includes("侧窗的锁扣死"), "accepted body must land in works/<title>/chapters/");
  step("candidate_accept", "第一章正文落盘 works/凌晨账本/chapters/c001.md");

  // 双采纳负例：同候选再 accept → 幂等硬拒
  out = await run("zhizhang_candidate_accept", { candidate: cand1 });
  assert.match(out, /candidate_already_accepted/, "double accept must be refused");
  step("双采纳负例", "同候选再 accept → 拒");

  // 兑付审计：章纲 ending vs 正文（锚点：侧窗/屏幕/02:10）
  out = await run("zhizhang_payoff_audit", { chapter: "c001" });
  assert.ok(!/ending_missing|ending_underdelivered/.test(out), "ending must be delivered");
  assert.match(out, /结论：ok（无警告）/, "payoff audit must pass on the aligned ending");
  assert.match(out, /ending_ok/, "receipt must carry the ending_ok code");
  step("zhizhang_payoff_audit", "章末兑付通过");

  // 审校留痕 + 定稿（状态直改，不动正文）
  out = await run("zhizhang_review_ledger", {
    action: "append",
    chapter: "c001",
    kind: "finalize",
    summary: "作者读毕：数字差成立，定稿",
  });
  assert.match(out, /已记入审校留痕/, "ledger append receipt");
  out = await run("zhizhang_chapter_save", { chapter: "c001", status: "final" });
  assert.match(out, /final|已保存|已定稿/);
  step("review_ledger + 定稿", "c001 → final");

  // ============================== 写作 · 第二章（续写 + 面板采纳） ==============================
  out = await run("zhizhang_outline_set", {
    chapter: "c002",
    title: "旧店名",
    situationLens: "查签字人的下落",
    livedScene: "对着员工墙照片找人",
    stateLens: "静、在排除",
    ending: "老蒋把刷卡小票推回来，时间戳是昨天的。",
  });
  assert.match(out, /已写入章纲/);

  out = await run("zhizhang_chapter_brief", { chapter: "c002" });
  assert.match(out, /续写/, "continuation brief must say so");
  assert.ok(out.includes("把侧窗的锁扣死"), "n≥2 brief must inject previous chapter body in full");
  step("chapter_brief(c002)", "前章正文全文注入");

  const body2 = [
    "员工墙在储物间门后，七年的照片钉了两排。何菱带着那张旧店名的小票站在墙前，一张一张对签名。",
    "对到第四张的时候她停下来。照片里的人系着和白班陈姐同款的围裙，胸牌上的名字被日光灯反光盖住一半。她没有摘照片，只是用指腹擦了擦相框玻璃。",
    "储物间的钟走得不匀。她等到第八个刻度，把小票折回原来的折痕，走出去。",
    "老蒋在门口收伞。他照旧刷卡，照旧不抬头，把小票从台面上推回来：「这张不是我的，我昨天的还在你那儿。」",
    "何菱接过小票。老蒋把刷卡小票推回来，时间戳是昨天的。",
  ].join("\n\n");
  out = await run("zhizhang_candidate_stage", { chapter: "c002", content: body2 });
  const cand2 = /cand-[a-z0-9]+/.exec(out)?.[0];
  out = await run("zhizhang_style_lint", { candidate: cand2 });
  assert.match(out, /lintPassToken：lint-/);

  // 外部架构：从面板 HTTP 采纳（作者在浏览器里点「采纳」走的正是这条）
  const server = http.createServer(
    (await import(pathToFileURL(path.join(pkgRoot, "dist/lib/http-api.js")).href)).createPanelApiHandler({
      storageRoot: ZZ,
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const api = `http://127.0.0.1:${port}/api/dsh-zhizhang`;
  try {
    let res = await fetch(`${api}/snapshot?work=${encodeURIComponent("凌晨账本")}`);
    const snap = await res.json();
    assert.equal(snap.ok, true);
    assert.equal(snap.snapshot.totals.chapters, 2, "panel must see both chapters");
    assert.ok(snap.snapshot.foundation.locks.length <= 601, "foundation must be capped for display");
    assert.ok((snap.snapshot.inspiration?.appliedCandIds ?? []).length >= 1, "inspiration view sees the applied emits");
    assert.ok(snap.snapshot.library?.sourcesCount >= 1, "panel must see the library");
    // 面板人工闸：POST 不带 confirm → 400（浏览器里「采纳」按钮的确认弹层对应这里）
    res = await fetch(`${api}/candidate/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ work: "凌晨账本", candidate: cand2 }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "confirm_required", "panel accept must require human confirm");
    res = await fetch(`${api}/candidate/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ work: "凌晨账本", candidate: cand2, confirm: true, mode: "append" }),
    });
    const accepted = await res.json();
    assert.equal(res.status, 200, `panel accept must succeed: ${JSON.stringify(accepted).slice(0, 200)}`);
    assert.equal(accepted.ok, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
  const c002File = path.join(ZZ, "works", "凌晨账本", "chapters", "c002.md");
  assert.ok((await stat(c002File)).isFile(), "panel-accepted chapter must land on disk");
  step("面板 HTTP 采纳 c002", "作者在面板点采纳 → 正文落盘");

  // ============================== 汇编与外部架构盘点 ==============================
  out = await run("zhizhang_assemble", { work: "凌晨账本", only_final: false });
  assert.match(out, /成稿：.*manuscripts/, "assemble receipt must name the manuscript");
  const manuscript = path.join(ZZ, "manuscripts", "凌晨账本.md");
  const ms = await readFile(manuscript, "utf8");
  assert.ok(ms.includes("把侧窗的锁扣死") && ms.includes("时间戳是昨天的"), "manuscript must contain both chapters");
  step("zhizhang_assemble", "manuscripts/凌晨账本.md（两章成稿）");

  out = await run("zhizhang_status", {});
  assert.match(out, /存储根/, "status must expose the storage root");
  step("zhizhang_status", "存储根可见（外部架构排查面）");

  // 磁盘树盘点：一个 AI / 一个人不打开代码也能看懂项目
  const tree = {
    "作品 meta": path.join(ZZ, "works", "凌晨账本", "meta.json"),
    "第一章": c001File,
    "第二章": c002File,
    "拆书报告": path.join(ZZ, "library", "analyses", srcId, "report.md"),
    "量化底座": path.join(ZZ, "library", "analyses", srcId, "survey.json"),
    "取卡索引": path.join(ZZ, "inspiration", "bindings.json"),
    "成稿": manuscript,
    "审校留痕": path.join(ZZ, "works", "凌晨账本", "ledger.json"),
  };
  for (const [label, p] of Object.entries(tree)) {
    assert.ok((await stat(p)).isFile(), `外部架构缺文件：${label} → ${p}`);
  }
  step("外部架构盘点", `${Object.keys(tree).length} 个落盘工件全部在位`);

  console.log(`\ne2e OK · ${stepNo} 步 · 拆书 → 灵感 → 写作 → 定稿 → 汇编 → 面板 全链真实闭环`);
} finally {
  await rm(root, { recursive: true, force: true });
}
