export interface MotifSpec {
  id: string;
  name: string;
}

/**
 * 从 S3 标题方法（s3-headline.md）读出母体清单：取标题含“母体”的二级节，
 * 读该节表格第一列（如 “**1 数字反差式**” → “数字反差式”），表格缺失时退回读列表项。
 */
export function parseMotifsFromS3(markdown: string): MotifSpec[] {
  const fromTable: string[] = [];
  const fromList: string[] = [];
  let inSection = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) {
      if (inSection) break;
      inSection = line.includes("母体");
      continue;
    }
    if (!inSection) continue;
    const cell = /^\|\s*([^|]+?)\s*\|/.exec(line)?.[1];
    const item = /^\s*(?:[-*]|\d+\.)\s+\*{0,2}([^：:*\n]+?)\*{0,2}(?:[：:]|$)/.exec(line)?.[1];
    const raw = cell ?? item;
    if (!raw || /^[-:\s]+$/.test(raw) || raw === "母体") continue;
    const name = raw
      .replace(/\*/g, "")
      .replace(/^\d+\s*/, "")
      .trim();
    const bucket = cell !== undefined ? fromTable : fromList;
    if (name && !bucket.includes(name)) bucket.push(name);
  }
  const names = fromTable.length > 0 ? fromTable : fromList;
  return names.map((name, i) => ({ id: `motif-${i + 1}`, name }));
}
