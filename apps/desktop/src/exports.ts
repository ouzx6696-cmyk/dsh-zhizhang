import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import { articleManuscript } from "../../../packages/toutiao/src/workbench/data";
import {
  ensureStorage,
  listProjects,
  projectIdOf,
  resolveWorkDir,
  readWorkMeta,
  readChapter,
} from "../../../packages/fanqie/src/engine/work-store";
import type { Target, Focus } from "./context";
export function publishText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*```[^\n]*\n|^\s*```\s*$/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(
      /^\s*[（(【\[]?(?:配图|配图提示|配图建议|插图建议|图片提示)[：:][^\n]*$/gm,
      "",
    )
    .trim();
}
export function publicationIssues(text: string) {
  const issues: string[] = [];
  if (/\[(?:待补|待写|TODO|占位)[^\]]*\]|\{[^}\n]{1,40}\}/i.test(text))
    issues.push("仍有占位标记");
  if (/<!--|```|\*\*/.test(text))
    issues.push("仍有 Markdown 或批注标记，请核对");
  return issues;
}
export async function exportContent(target: Target, focus: Focus) {
  if (target.mode === "toutiao") {
    if (!focus.article) throw new Error("请先选择要交稿的文章");
    const article = await articleManuscript(target.root, focus.article);
    const body = publishText(article.text);
    const text =
      article.title +
      "\n\n" +
      (body.split("\n")[0].trim() === article.title.trim()
        ? body
            .slice(body.indexOf("\n") < 0 ? body.length : body.indexOf("\n"))
            .trimStart()
        : body);
    return {
      title: article.title,
      text,
      issues: [
        ...publicationIssues(text),
        ...(!article.qaValid ? ["当前稿件尚未通过有效质检"] : []),
      ],
      reminder:
        "发布时请按平台要求声明 AI 生成；故事线或合成人物须注明虚构演绎。",
    };
  }
  if (!target.work) throw new Error("请先选择作品");
  const project = (await listProjects()).find(
    (item) => item.id === projectIdOf(target.root),
  );
  const dir = await resolveWorkDir(
    await ensureStorage(null, {
      storageRoot: target.root,
      worksRoot: project?.worksRoot,
    }),
    target.work,
  );
  const meta = await readWorkMeta(dir),
    sections: string[] = [],
    issues: string[] = [];
  for (const row of [...meta.chapters].sort(
    (a, b) => a.position - b.position,
  )) {
    const chapter = await readChapter(dir, row.id);
    if (chapter.status !== "final") continue;
    sections.push(
      `第${row.position}章 ${chapter.title}\n\n${publishText(chapter.body)}`,
    );
    issues.push(
      ...publicationIssues(publishText(chapter.body)).map(
        (issue) => `${chapter.title}：${issue}`,
      ),
    );
  }
  if (!sections.length)
    throw new Error("还没有已定稿章节，先在写作台完成作者定稿");
  return {
    title: meta.title,
    text: sections.join("\n\n\n"),
    issues,
    reminder:
      "导出内容仅包含当前已定稿章节。发布前请核对平台要求的 AI 生成声明；应用不会登录或自动发布。",
  };
}
export async function wordDocument(title: string, text: string) {
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
            ...(text.startsWith(title + "\n")
              ? text.slice(title.length).trimStart()
              : text
            )
              .split("\n")
              .map(
                (line) =>
                  new Paragraph({ text: line, spacing: { after: 160 } }),
              ),
          ],
        },
      ],
    }),
  );
}
