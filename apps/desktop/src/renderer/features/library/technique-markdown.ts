/**
 * 拆书技法卡与 Markdown 逻辑结构双向辅助函数（零 DOM 依赖，可独立单测）。
 */
import type { TechniqueCardView } from "@zhizhang/workbench/contract";

export type InjectionTier = "l2-craft" | "l6-reference";

export interface TechniqueMarkdownLabels {
  layerLabel: (layer: string) => string;
  dimensionLabel: (dimension: string) => string;
  quoteStatusLabel: (status: string) => string;
  tierL2: string;
  tierL6: string;
  metaTier: string;
  metaLayer: string;
  metaDimension: string;
  metaQuote: string;
  secPattern: string;
  secSteps: string;
  secTransfer: string;
  secGuard: string;
  secExample: string;
  fieldEmotionArc: string;
  fieldReaderWant: string;
  fieldDramaticUnit: string;
  fieldTransfer: string;
  fieldUsage: string;
  fieldFailWhen: string;
  fieldMustNotCopy: string;
  fieldBannedDiction: string;
}

const CRAFT_LAYERS = new Set(["scene", "chapter", "line"]);

/** 与后端 buildChapterContext 一致：场景/章节/句子层级自动晋升为 L2 实操高优注入。 */
export function cardInjectionTier(layer?: TechniqueCardView["layer"]): InjectionTier {
  return layer && CRAFT_LAYERS.has(layer) ? "l2-craft" : "l6-reference";
}

/** 将多行文本解析为去空白字符串数组。 */
export function parseLineList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 生成新的空白技法卡模板。 */
export function createEmptyTechniqueCard(
  existingCount: number,
  defaults: { title: string; category: string },
): TechniqueCardView {
  return {
    id: `card-custom-${Date.now().toString(36)}-${existingCount + 1}`,
    title: defaults.title,
    category: defaults.category,
    layer: "scene",
    dimension: "rhythm",
    pattern: "",
    readerWant: "",
    emotionArc: "",
    dramaticUnit: "",
    steps: [""],
    transfer: "",
    usage: "",
    failWhen: "",
    mustNotCopy: [],
    bannedDiction: [],
    example: "",
  };
}

/** 将结构化技法卡编译为可读、可检视的 Markdown 逻辑结构文档。 */
export function techniqueCardToMarkdown(
  card: TechniqueCardView,
  labels: TechniqueMarkdownLabels,
): string {
  const tier = cardInjectionTier(card.layer);
  const tierText = tier === "l2-craft" ? labels.tierL2 : labels.tierL6;
  const layerText = card.layer ? labels.layerLabel(card.layer) : "—";
  const dimText = card.dimension ? labels.dimensionLabel(card.dimension) : "—";
  const quoteText = card.quoteStatus
    ? `${labels.quoteStatusLabel(card.quoteStatus)}${card.quoteLine ? ` (L${card.quoteLine})` : ""}`
    : "—";

  const lines: string[] = [
    `# ${card.title || "未命名技法"}`,
    "",
    `| ${labels.metaLayer} | ${labels.metaDimension} | ${labels.metaTier} | ${labels.metaQuote} |`,
    "| --- | --- | --- | --- |",
    `| ${layerText} | ${dimText} | ${tierText} | ${quoteText} |`,
    "",
    `## ${labels.secPattern}`,
    "",
    card.pattern.trim() || "—",
  ];

  const metaBullets: string[] = [];
  if (card.readerWant?.trim()) {
    metaBullets.push(`- **${labels.fieldReaderWant}**：${card.readerWant.trim()}`);
  }
  if (card.emotionArc?.trim()) {
    metaBullets.push(`- **${labels.fieldEmotionArc}**：${card.emotionArc.trim()}`);
  }
  if (card.dramaticUnit?.trim()) {
    metaBullets.push(`- **${labels.fieldDramaticUnit}**：${card.dramaticUnit.trim()}`);
  }
  if (metaBullets.length > 0) {
    lines.push("", ...metaBullets);
  }

  const validSteps = (card.steps ?? []).map((s) => s.trim()).filter(Boolean);
  if (validSteps.length > 0) {
    lines.push("", `## ${labels.secSteps}`, "");
    validSteps.forEach((step, idx) => {
      lines.push(`${idx + 1}. ${step}`);
    });
  }

  const transferBullets: string[] = [];
  if (card.transfer?.trim()) {
    transferBullets.push(`- **${labels.fieldTransfer}**：${card.transfer.trim()}`);
  }
  if (card.usage?.trim()) {
    transferBullets.push(`- **${labels.fieldUsage}**：${card.usage.trim()}`);
  }
  if (card.failWhen?.trim()) {
    transferBullets.push(`- **${labels.fieldFailWhen}**：${card.failWhen.trim()}`);
  }
  if (transferBullets.length > 0) {
    lines.push("", `## ${labels.secTransfer}`, "", ...transferBullets);
  }

  const mustNot = (card.mustNotCopy ?? []).map((s) => s.trim()).filter(Boolean);
  const banned = (card.bannedDiction ?? []).map((s) => s.trim()).filter(Boolean);
  if (mustNot.length > 0 || banned.length > 0) {
    lines.push("", `## ${labels.secGuard}`, "");
    if (mustNot.length > 0) {
      lines.push(`- **${labels.fieldMustNotCopy}**：${mustNot.join("；")}`);
    }
    if (banned.length > 0) {
      lines.push(`- **${labels.fieldBannedDiction}**：${banned.join("、")}`);
    }
  }

  if (card.example.trim()) {
    lines.push("", `## ${labels.secExample}`, "");
    for (const row of card.example.trim().split(/\r?\n/)) {
      lines.push(`> ${row}`);
    }
  }

  return lines.join("\n");
}
