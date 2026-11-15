export interface MotifSpec {
  id: string;
  name: string;
}

export function parseMotifsFromS3(markdown: string): MotifSpec[] {
  const lines = markdown.split(/\r?\n/);
  const motifs: MotifSpec[] = [];
  let inFirstSection = false;

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (inFirstSection) break;
      inFirstSection = true;
      continue;
    }
    if (!inFirstSection) continue;
    const match = /^\s*(?:[-*]|\d+\.)\s+\*{0,2}([^：:*\n]+?)\*{0,2}(?:[：:]|$)/.exec(line);
    if (match) {
      const name = match[1].trim();
      if (name && !motifs.some((m) => m.name === name)) {
        motifs.push({ id: `motif-${motifs.length + 1}`, name });
      }
    }
  }
  return motifs;
}
