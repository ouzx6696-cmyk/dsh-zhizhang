import { readContinuity } from "../workflow/continuity";
import { chapterTail } from "../../../../packages/fanqie/src/engine/storage/chapters";
import { resolveFanqieWork } from "../main/storage";
import type { Target, Focus } from "../context";
import type { Chapter, Outline, WorkMeta } from "../../../../packages/fanqie/src/engine/types";
import { readChapter, readWorkMeta } from "../../../../packages/fanqie/src/engine/work-store";
import { exists, readText, sha256 } from "../../../../packages/core/src/fsx";
import {
  ArticleStore,
  formatFeedbackLine,
  parseFeedbackEntries,
  type ArticleMeta,
} from "../../../../packages/toutiao/src/store";
import { formatPlanningBrief } from "../../../../packages/fanqie/src/engine/domain/planning";
import {
  bodyFingerprint,
  chapterReviewInfo,
  latestReview,
  renderReview,
  type ReviewReport,
} from "../../../../packages/fanqie/src/review";
import type {
  FanqieSnapshot,
  ToutiaoSnapshot,
  MethodAttachmentKind,
} from "../../../../packages/core/src/method-pack";
import type { Sessions } from "./manager";
// outline_check readiness 的会话侧同判据（判据源：packages/fanqie/skill/forge/inspiration-forge/scripts/check_outline.py）：
// 8 字段非空、目标篇幅为正、无显式占位（窄标记，普通中文括注不算占位）。
const OUTLINE_FIELDS = [
  "synopsis",
  "conflict",
  "beats",
  "ending",
  "pov",
  "locks",
  "knowledge",
] as const;
const OUTLINE_PLACEHOLDER =
  /\b(?:TODO|TBD)\b|待填写|待填充|待正文发挥|【\s*】|【[^】]*(?:待填|待补|填写|在此|工作标题|叙述位置|计划篇幅|作者锁定|人物可知|主要经历|读者经历|结果或体验|人物[^】]{0,20}边界)[^】]*】|(?:^|\n)\s*待补\s*(?=\n|$)/;

/** 章纲是否已写（8 字段任一非空）。 */
function outlineFilled(outline: Outline) {
  return OUTLINE_FIELDS.some((field) => outline[field].trim().length > 0);
}

/** 章纲是否过机械检查（fanqie_outline_check readiness 同判据）。 */
function outlinePassed(outline: Outline) {
  return (
    outline.targetWords > 0 &&
    OUTLINE_FIELDS.every((field) => outline[field].trim().length > 0) &&
    !OUTLINE_FIELDS.some((field) => OUTLINE_PLACEHOLDER.test(outline[field]))
  );
}

interface FanqieStorage {
  dir: string;
  meta: WorkMeta;
  chapter?: Chapter;
}

/** v2 快照收集：读一次作品与指向章，决策表判据与附件落地共用；没打开作品时只有 hasWork=false。 */
export async function fanqieContext(
  host: Sessions,
  target: Target,
  focus: Focus,
): Promise<{ snapshot: FanqieSnapshot; storage?: FanqieStorage }> {
  const snapshot: FanqieSnapshot = { hasWork: false, chapter: null };
  if (!target.work) return { snapshot };
  const dir = await resolveFanqieWork(host.options, target);
  const meta = await readWorkMeta(dir);
  snapshot.hasWork = true;
  const row = meta.chapters.find((candidate) => candidate.id === focus.chapter);
  const chapter = row ? await readChapter(dir, row.id) : undefined;
  if (chapter) {
    const info = await chapterReviewInfo(
      dir,
      chapter.id,
      chapter.body,
      !!host.options.fanqie?.requireEditorPass,
    );
    snapshot.chapter = {
      id: chapter.id,
      hasOutline: outlineFilled(chapter.outline),
      outlinePassed: outlinePassed(chapter.outline),
      status: chapter.status,
      latestReviewPassed: info.editorReview
        ? !info.editorReview.stale && info.editorReview.verdict === "通过"
        : null,
    };
  }
  return { snapshot, storage: { dir, meta, chapter } };
}

/** S4 交接附最近作者反馈：病型与本次内容线匹配（G1~G4 是故事线病型，只给故事线）或最近 3 条，
 * 从最新往回装，软上限 1000 字（最新一条超限也保留）。 */
const STORY_ONLY_DISEASE = /^G[1-4]/;
const FEEDBACK_CAP = 1000;

export async function toutiaoFeedback(
  store: ArticleStore,
  contentLine: "news" | "story" | "micro",
): Promise<string | undefined> {
  const text = await readText(store.feedbackPath);
  if (!text) return undefined;
  const entries = parseFeedbackEntries(text);
  const relevant = entries.filter(
    (entry, index) =>
      entries.length - index <= 3 ||
      !entry.病型 ||
      contentLine === "story" ||
      !STORY_ONLY_DISEASE.test(entry.病型),
  );
  const lines: string[] = [];
  let budget = FEEDBACK_CAP;
  for (let i = relevant.length - 1; i >= 0; i--) {
    const line = formatFeedbackLine(relevant[i]);
    if (lines.length > 0 && line.length > budget) break;
    lines.push(line);
    budget -= line.length + 1;
  }
  if (lines.length === 0) return undefined;
  return `作者改稿反馈（最近）：\n${lines.reverse().join("\n")}`;
}

/** v2 头条快照：文章状态、体裁线归并（微头条体裁→micro）与 S2–S4 产出判断。 */
export async function toutiaoContext(
  target: Target,
  focus: Focus,
): Promise<{ store: ArticleStore; article?: ArticleMeta; snapshot: ToutiaoSnapshot }> {
  const store = new ArticleStore(target.root);
  if (!focus.article) return { store, snapshot: { article: null } };
  const article = await store.get(focus.article);
  return {
    store,
    article,
    snapshot: {
      article: {
        stage: article.status,
        contentLine:
          article.genre === "微头条" ? "micro" : article.line === "故事线" ? "story" : "news",
        hasCard: await exists(store.cardPath(article.id)),
        hasHeadline: article.headlines.main.trim().length > 0,
        hasDraft: article.drafts.length > 0,
      },
    },
  };
}

/** 上一章结尾节选按需读取，索引只保留来源凭据。 */
async function previousEnding(dir: string, meta: WorkMeta, chapterId: string, pursuit: boolean) {
  const rows = [...meta.chapters].sort((a, b) => a.position - b.position);
  const index = rows.findIndex((row) => row.id === chapterId);
  const previous = index > 0 ? rows[index - 1] : undefined;
  if (!previous) return undefined;
  if (pursuit) {
    const chapter = await readChapter(dir, previous.id);
    const summary = (await readContinuity(dir)).chapters.find(
      (row) => row.id === previous.id && row.hash === sha256(chapter.body),
    )?.summary;
    return `${previous.title}（${previous.id}）结尾1500字：${chapter.body.slice(-1500)}${summary ? "\n前章摘要：" + summary : ""}`;
  }
  const tail = await chapterTail(dir, previous.id, 300);
  return tail ? `${previous.title}（${previous.id}）结尾节选：${tail}` : undefined;
}

/** 幕纲节选：复用写作台的规划简报渲染（全书与本章关联卷/幕，内部已截断）。 */
function actOutline(meta: WorkMeta, chapterId: string) {
  return formatPlanningBrief(meta, chapterId) || undefined;
}

/** 修改范围：回报里的 L1–L3 位置清单；回报没有定位就不附。 */
function revisionScope(report: ReviewReport) {
  return report.levels.length
    ? report.levels
        .map((level) => `${level.level} ${level.location}：${level.symptom} → ${level.fix}`)
        .join("\n")
    : undefined;
}

/** v2 附件落地：按 kind 收集回报全文、修改范围、上一章结尾与幕纲节选；拿不到材料的 kind 不输出。 */
export async function fanqieAttachments(
  dir: string,
  meta: WorkMeta,
  chapter: Chapter,
  kinds: MethodAttachmentKind[],
  pursuit = false,
) {
  const report =
    kinds.includes("review-report") || kinds.includes("revision-scope")
      ? await latestReview(dir, chapter.id)
      : undefined;
  const scope = report ? revisionScope(report) : undefined;
  return {
    ...(report && kinds.includes("review-report")
      ? { reviewReport: renderReview(report, report.body_sha256 !== bodyFingerprint(chapter.body)) }
      : {}),
    ...(report && kinds.includes("revision-scope") && scope ? { revisionScope: scope } : {}),
    ...(kinds.includes("previous-ending")
      ? { previousEnding: await previousEnding(dir, meta, chapter.id, pursuit) }
      : {}),
    ...(kinds.includes("act-outline") ? { actOutline: actOutline(meta, chapter.id) } : {}),
  };
}
