/** 导出用的 Word 文档打包（主进程使用；docx 只在这里引入）。 */
import { Document, HeadingLevel, Packer, Paragraph } from "docx";

export async function wordDocument(title: string, text: string): Promise<Buffer> {
  const body = text.startsWith(`${title}\n`) ? text.slice(title.length).trimStart() : text;
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
            ...body.split("\n").map((line) => new Paragraph({ text: line, spacing: { after: 160 } })),
          ],
        },
      ],
    }),
  );
}
