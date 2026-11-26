/**
 * Web 预览沙箱初始化：当沙箱写作文件夹尚无番茄作品或头条文章时，
 * 经正式的 L2 命令写入一部示例番茄作品与一篇示例头条文章，并记录最近目标，便于开箱体验完整工作台。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { atomicWrite, recordRecentTarget } from "@zhizhang/core/fs";
import type { LockService } from "@zhizhang/core/lock";
import { commands as fanqie } from "@zhizhang/fanqie";
import { commands as toutiao } from "@zhizhang/toutiao";
import type { WorkspaceRoots } from "../shared/views.js";

const SAMPLE_WORK_DIR = "云海闻铃";
const SAMPLE_CHAPTER_1 = [
  "青崖镇的秋雨总是从傍晚开始落，先是细密的雾珠扑在青石板上，随后整条长街便被灯笼映成一层微湿的琥珀色。",
  "沈砚把最后一只铜铃挂上檐角时，街口那辆青布马车正好停在药铺门前。车帘掀开一角，递出来的却不是诊金，而是一枚刻着半截山纹的旧玉牌。",
  "“掌柜的，三年前你答应过，见玉如见人。”车里传出的声音不高，却压过了雨打芭蕉的碎响，“今夜子时前，借你后院的古井一用。”",
  "沈砚指尖顿了顿，铜铃在风里轻轻一晃，发出一声极短、极清的回音。他知道，蛰伏了三年的旧账，终于顺着这场秋雨找上门了。",
].join("\n\n");

const SAMPLE_CHAPTER_2 = [
  "【章纲】",
  "1. 沈砚试探来客身份，确认玉牌出自旧友林伯之手。",
  "2. 后院古井异响，水面映出不合时令的星图倒影。",
  "3. 镇外巡夜锣声逼近，来客留下暗号匆匆离去，引出次日赴州府查案的主线。",
].join("\n\n");

const SAMPLE_ARTICLE_TITLE = "胡同里的十二年旧书店：换一种方式留住纸香";
const SAMPLE_ARTICLE_BODY = [
  "许多老城区的书店正在悄悄改变模样：不再只卖畅销书，而是把一半面积留给社区自习角与周末旧书交换。",
  "一位在胡同里守了十二年的店主说，纸质书并没有消失，只是读者进门前，先需要一个愿意坐下来的理由。",
  "当灯光、茶水和一场不急着散场的邻里分享会重新聚在一起，书架也就重新拥有了温度。",
].join("\n\n");

export async function seedWebPreviewWorkspace(opts: {
  roots: WorkspaceRoots;
  locks: LockService;
  clock: Clock;
}): Promise<void> {
  const [works, articles] = await Promise.all([
    fanqie.listWorks(opts.roots.fanqie).catch(() => []),
    toutiao.listArticleRowsCommand(opts.roots.toutiao).catch(() => ({ rows: [] })),
  ]);
  const nowIso = opts.clock.iso();

  if (works.length === 0) {
    const workPath = path.join(opts.roots.fanqie, SAMPLE_WORK_DIR);
    await fanqie.createWork(
      workPath,
      { id: "w-demo-yunhai", title: SAMPLE_WORK_DIR, grade: "standard" },
      opts.locks,
    );
    await fs.mkdir(path.join(workPath, "plan"), { recursive: true });
    await atomicWrite(
      path.join(workPath, "plan", "premise.md"),
      "青崖镇药铺掌柜沈砚守着一口能映旧事的古井，因一枚山纹玉牌卷入三年前州府沉案。\n",
    );
    await fanqie.saveChapter(
      workPath,
      { chapterId: "ch-001", title: "第一章 雾起青崖", body: SAMPLE_CHAPTER_1, status: "drafted" },
      opts.locks,
    );
    await fanqie.saveChapter(
      workPath,
      { chapterId: "ch-002", title: "第二章 纸灯照影", body: SAMPLE_CHAPTER_2, status: "planned" },
      opts.locks,
    );

    const pending = await fanqie.proposeBibleOps(
      workPath,
      [
        {
          type: "entity.upsert",
          entity: {
            id: "ent-shenyan",
            kind: "character",
            name: "沈砚",
            aliases: ["沈掌柜"],
            summary: "青崖镇药铺掌柜，擅长辨脉与古器修补，守着后院古井三年。",
            locked: ["name"],
            provenance: { source: "author", at: nowIso },
          },
        },
        {
          type: "thread.upsert",
          thread: {
            id: "th-jade-token",
            title: "半截山纹玉牌的来历",
            kind: "mystery",
            opened: 1,
            plannedPayoff: 10,
            beats: [{ chapter: 1, kind: "plant", note: "神秘来客雨夜持玉牌登门借古井。" }],
            status: "open",
          },
        },
      ],
      { source: "author", at: nowIso },
      opts.locks,
    );
    for (const item of pending) {
      await fanqie.decideBiblePending(workPath, item.id, "accept", opts.locks);
    }

    await recordRecentTarget(
      { mode: "fanqie", path: workPath, title: SAMPLE_WORK_DIR },
      nowIso,
    ).catch(() => undefined);
  }

  if (articles.rows.length === 0) {
    const created = await toutiao.createArticleCommand(
      {
        root: opts.roots.toutiao,
        id: "tt-demo-001",
        genre: "短图文",
        driver: "故事型",
      },
      opts.locks,
    );
    await atomicWrite(
      path.join(created.articleDir, "card.json"),
      JSON.stringify(
        {
          主标题: SAMPLE_ARTICLE_TITLE,
          体裁: "短图文",
          主驱动: "故事型",
          内容线: "社会生活",
          主问题: "老城区独立书店靠什么留住进门的人",
        },
        null,
        2,
      ),
    );
    await toutiao.registerSourceCommand(
      {
        articleDir: created.articleDir,
        sourceId: "src-001",
        kind: "paste",
        content:
          "2026 年春访谈记录：店主陈叔在胡同口经营旧书店十二年，近年增设自习角与周末旧书交换。",
      },
      opts.locks,
    );
    await toutiao.saveDraftCommand(
      {
        articleDir: created.articleDir,
        title: SAMPLE_ARTICLE_TITLE,
        body: SAMPLE_ARTICLE_BODY,
      },
      opts.locks,
    );
  }
}
