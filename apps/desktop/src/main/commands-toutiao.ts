import { commands as toutiao } from "@zhizhang/toutiao";
import {
  assertOutPath,
  safeId,
  type CommandGroup,
  type CommandHandler,
} from "./commands-shared.js";

export const TOUTIAO_HANDLERS: { [K in CommandGroup<"toutiao">]: CommandHandler<K> } = {
  async "toutiao.articles"(input, ctx) {
    return toutiao.listArticleRowsCommand(ctx.inside(input.root));
  },
  async "toutiao.article.create"(input, ctx) {
    const { articleDir } = await toutiao.createArticleCommand(
      {
        root: ctx.inside(input.root),
        genre: input.genre,
        driver: input.driver,
        ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
      },
      ctx.locks,
    );
    return { articleDir };
  },
  async "toutiao.article.transition"(input, ctx) {
    const { status } = await toutiao.transitionArticleCommand(
      { articleDir: ctx.inside(input.articleDir), to: input.to },
      ctx.locks,
    );
    return { status };
  },
  async "toutiao.article.deliver"(input, ctx) {
    const { deliveryPath } = await toutiao.deliverArticleCommand(
      {
        articleDir: ctx.inside(input.articleDir),
        title: input.title,
        body: input.body,
        ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
      },
      ctx.locks,
    );
    return { deliveryPath };
  },
  async "toutiao.article.export"(input, ctx) {
    const format = input.format ?? "md";
    return toutiao.exportArticleCommand({
      articleDir: ctx.inside(input.articleDir),
      outPath: assertOutPath(input.outPath, format),
      format,
      ...(input.includeDelivery !== undefined ? { includeDelivery: input.includeDelivery } : {}),
    });
  },
  async "toutiao.draft.get"(input, ctx) {
    return toutiao.readDraftCommand(ctx.inside(input.articleDir));
  },
  async "toutiao.draft.save"(input, ctx) {
    return toutiao.saveDraftCommand(
      { ...input, articleDir: ctx.inside(input.articleDir) },
      ctx.locks,
    );
  },
  async "toutiao.source.register"(input, ctx) {
    return toutiao.registerSourceCommand(
      {
        articleDir: ctx.inside(input.articleDir),
        sourceId: safeId(input.sourceId, "sourceId"),
        kind: input.kind,
        content: input.content,
      },
      ctx.locks,
    );
  },
  async "toutiao.ledger.show"(input, ctx) {
    return toutiao.ledgerShowCommand({
      ledgerPath: ctx.inside(input.ledgerPath),
      ...(input.last ? { last: input.last } : {}),
      ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
    });
  },
  async "toutiao.ledger.add"(input, ctx) {
    return toutiao.ledgerAddCommand({
      ...input,
      cardPath: ctx.inside(input.cardPath),
      ledgerPath: ctx.inside(input.ledgerPath),
      ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
    });
  },
  async "toutiao.ledger.status"(input, ctx) {
    return toutiao.ledgerStatusCommand({
      ...input,
      ledgerPath: ctx.inside(input.ledgerPath),
      ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
    });
  },
  async "toutiao.metrics.import"(input, ctx) {
    return toutiao.metricsImportCommand({
      ...input,
      ledgerPath: ctx.inside(input.ledgerPath),
      ...(ctx.scriptsDir ? { scriptsDir: ctx.scriptsDir } : {}),
    });
  },
};
