import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import {
  atomicWrite,
  resolveInside,
  resolveResourcePath,
  readTextIfExists,
  sha256,
} from "@zhizhang/core/fs";
import type {
  ContextPacket,
  DeliveryReceipt,
  PipelineDefinition,
  StageSpec,
} from "@zhizhang/core/pipeline";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { arr, obj, opt, parseJson, str, type Infer } from "@zhizhang/core/schema";

export const DissectReq = obj({
  sourceId: str({ min: 1 }),
  title: str({ min: 1 }),
  sourcePath: opt(str()),
});

export type DissectInput = Infer<typeof DissectReq>;

export interface DissectPlanOutput {
  dimensions: string[];
  focusQuestions: string[];
}

export interface DissectAnalyzeOutput {
  observations: Array<{ dimension: string; finding: string; evidence: string }>;
  pacingNotes: string;
}

export interface TechniqueCard {
  id: string;
  title: string;
  category: string;
  pattern: string;
  example: string;
  usage: string;
}

export interface DissectCardsOutput {
  cards: TechniqueCard[];
  summary: string;
}

export interface DissectResult {
  sourceId: string;
  title: string;
  plan: DissectPlanOutput;
  analysis: DissectAnalyzeOutput;
  cards: TechniqueCard[];
  cardCount: number;
  summary: string;
}

const DissectPlanSchema = obj({
  dimensions: arr(str({ min: 1 }), { max: 12 }),
  focusQuestions: arr(str({ min: 1 }), { max: 20 }),
});

const DissectAnalyzeSchema = obj({
  observations: arr(
    obj({
      dimension: str({ min: 1 }),
      finding: str({ min: 1 }),
      evidence: str({ min: 1 }),
    }),
    { max: 40 },
  ),
  pacingNotes: str({ min: 1 }),
});

const DissectCardsSchema = obj({
  cards: arr(
    obj({
      id: str({ min: 1 }),
      title: str({ min: 1 }),
      category: str({ min: 1 }),
      pattern: str({ min: 1 }),
      example: str({ min: 1 }),
      usage: str({ min: 1 }),
    }),
    { max: 30 },
  ),
  summary: str({ min: 1 }),
});

export const dissectPlanStage: StageSpec<
  { sourceId: string; title: string; sample: string },
  DissectPlanOutput
> = {
  id: "plan",
  title: "拆书方案",
  role: "planner",
  method: { stage: "library.dissect" },
  input: (ctx) => ({
    sourceId: (ctx.request as DissectInput).sourceId,
    title: (ctx.request as DissectInput).title,
    sample: String(ctx.state.sample ?? ""),
  }),
  shape: 'JSON 格式：{"dimensions":["拆解维度"],"focusQuestions":["关键问题"]}',
  format: "json",
  parse: (raw) => parseJson(raw, DissectPlanSchema, "dissect.plan"),
};

export const dissectAnalyzeStage: StageSpec<
  { sourceId: string; title: string; plan: DissectPlanOutput; chunks: string[] },
  DissectAnalyzeOutput
> = {
  id: "analyze",
  title: "逐维拆解",
  role: "extractor",
  method: { stage: "library.dissect" },
  input: (ctx) => ({
    sourceId: (ctx.request as DissectInput).sourceId,
    title: (ctx.request as DissectInput).title,
    plan: ctx.state.plan as DissectPlanOutput,
    chunks: (ctx.state.chunks as string[] | undefined) ?? [],
  }),
  shape:
    'JSON 格式：{"observations":[{"dimension":"维度","finding":"发现","evidence":"原文例证"}],"pacingNotes":"节奏总评"}',
  format: "json",
  parse: (raw) => parseJson(raw, DissectAnalyzeSchema, "dissect.analyze"),
};

export const dissectCardsStage: StageSpec<
  { sourceId: string; title: string; analysis: DissectAnalyzeOutput },
  DissectCardsOutput
> = {
  id: "cards",
  title: "提炼技法卡",
  role: "planner",
  method: { stage: "library.dissect" },
  input: (ctx) => ({
    sourceId: (ctx.request as DissectInput).sourceId,
    title: (ctx.request as DissectInput).title,
    analysis: ctx.state.analysis as DissectAnalyzeOutput,
  }),
  shape:
    'JSON 格式：{"cards":[{"id":"card-1","title":"技法名","category":"类别","pattern":"公式","example":"例证","usage":"适用场景"}],"summary":"拆书总结"}',
  format: "json",
  parse: (raw) => parseJson(raw, DissectCardsSchema, "dissect.cards"),
};

export const dissectPipeline: PipelineDefinition<DissectInput, DissectResult> = {
  kind: "library.dissect",
  request: DissectReq,
  async context(target, req) {
    return { runId: `dissect-${Date.now()}`, target, request: req, state: {} };
  },
  async run(runner, ctx) {
    const req = ctx.request as DissectInput;

    // 1. import
    const imported = await runner.local("import", async () => {
      const candidates = [
        req.sourcePath
          ? resolveInside(
              ctx.target.path,
              path.relative(ctx.target.path, path.resolve(req.sourcePath)),
            )
          : undefined,
        resolveResourcePath(ctx.target.path, "sources", `${req.sourceId}.txt`),
        resolveResourcePath(ctx.target.path, "sources", `${req.sourceId}.md`),
      ].filter((p): p is string => Boolean(p));

      let text: string | undefined;
      for (const candidate of candidates) {
        text = await readTextIfExists(candidate);
        if (text) break;
      }
      if (!text) {
        throw new AppError("input.not_found", `未找到拆书源文件：${req.sourceId}`, {
          sourceId: req.sourceId,
        });
      }
      const chunkSize = 4000;
      const chunks: string[] = [];
      for (let i = 0; i < text.length && chunks.length < 10; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
      }
      return { sample: text.slice(0, 2000), chunks };
    });

    ctx.state.sample = imported.sample;
    ctx.state.chunks = imported.chunks;

    const packet: ContextPacket = {
      prefix: [
        {
          id: "dissect-sample",
          layer: 0,
          text: `拆书作品：《${req.title}》\n\n${imported.sample}`,
          required: true,
          tokens: Math.ceil(imported.sample.length / 2),
          reason: "拆书样本导入",
          source: { kind: "library", ref: req.sourceId },
        },
      ],
      suffix: [],
      omitted: [],
      estimate: Math.ceil(imported.sample.length / 2),
    };

    // 2. plan
    const plan = await runner.stage(dissectPlanStage, packet);
    ctx.state.plan = plan;

    // 3. analyze
    const analysis = await runner.stage(dissectAnalyzeStage, packet);
    ctx.state.analysis = analysis;

    // 4. cards
    const cardOutput = await runner.stage(dissectCardsStage, packet);

    return {
      sourceId: req.sourceId,
      title: req.title,
      plan,
      analysis,
      cards: cardOutput.cards,
      cardCount: cardOutput.cards.length,
      summary: cardOutput.summary,
    };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    const outDir = resolveResourcePath(ctx.target.path, "analyses", res.sourceId);
    const marker = path.join(outDir, `${ctx.runId}.marker.json`);
    const cardsJson = JSON.stringify(res.cards, null, 2);

    if (await isAlreadyDelivered(marker, ctx.runId)) {
      return {
        runId: ctx.runId,
        deliveredPaths: [],
        contentHash: sha256(cardsJson),
        summary: "已幂等交付拆书结果",
      };
    }

    const reportPath = path.join(outDir, "report.md");
    const cardsPath = path.join(outDir, "cards.json");
    const reportText = [
      `# ${res.title} 拆书报告`,
      "",
      `> ${res.summary}`,
      "",
      `## 拆解维度`,
      ...res.plan.dimensions.map((d) => `- ${d}`),
      "",
      `## 节奏总评`,
      res.analysis.pacingNotes,
      "",
      `## 技法卡（${res.cardCount} 张）`,
      ...res.cards.map(
        (c) =>
          `### ${c.title}（${c.category}）\n- 模式：${c.pattern}\n- 例证：${c.example}\n- 用法：${c.usage}`,
      ),
      "",
    ].join("\n");

    await atomicWrite(cardsPath, cardsJson);
    await atomicWrite(reportPath, reportText);
    await atomicWrite(marker, buildDeliveryMarker(ctx.runId, cardsJson));

    return {
      runId: ctx.runId,
      deliveredPaths: [reportPath, cardsPath],
      contentHash: sha256(cardsJson),
      summary: `拆书完成，生成技法卡 ${res.cardCount} 张`,
    };
  },
  async recover(record, ctx) {
    const req = ctx.request as DissectInput;
    const marker = resolveResourcePath(
      ctx.target.path,
      "analyses",
      req.sourceId,
      `${record.id}.marker.json`,
    );
    return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
  },
};
