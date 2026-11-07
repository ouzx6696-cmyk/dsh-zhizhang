/** Descriptive measurements, never a replacement for an editor's reading judgment. */
export function readability(body: string) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const lengths = paragraphs.map((value) => [...value].length);
  const characters = [...body.replace(/\s/g, "")].length;
  const dialogue = [...body.matchAll(/“([^”]*)”/g)].reduce(
    (sum, match) => sum + [...match[1]].length,
    0,
  );
  return {
    characters,
    paragraphs: paragraphs.length,
    maxParagraph: Math.max(0, ...lengths),
    averageParagraph: paragraphs.length
      ? Math.round(lengths.reduce((a, b) => a + b, 0) / paragraphs.length)
      : 0,
    dialogueShare: characters ? Number((dialogue / characters).toFixed(3)) : 0,
    firstScreen: body.slice(0, 300),
  };
}
