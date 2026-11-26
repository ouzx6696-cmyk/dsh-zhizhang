import { AppError } from "@zhizhang/core/errors";
import { int, obj, opt, str, type Infer } from "@zhizhang/core/schema";
import {
  createRulesBridge,
  type LedgerMutateResult,
  type LedgerShowResult,
} from "../rules/bridge.js";

export const LedgerShowReq = obj({
  ledgerPath: str({ min: 1 }),
  last: opt(int({ min: 1, max: 200 })),
});

export const LedgerAddReq = obj({
  cardPath: str({ min: 1 }),
  ledgerPath: str({ min: 1 }),
  articleId: opt(str()),
  status: opt(str()),
  date: opt(str()),
});

export const LedgerStatusReq = obj({
  title: str({ min: 1 }),
  to: str({ min: 1 }),
  ledgerPath: str({ min: 1 }),
  articleId: opt(str()),
});

export const MetricsImportReq = obj({
  articleId: str({ min: 1 }),
  metricsJson: str({ min: 1 }),
  ledgerPath: str({ min: 1 }),
  url: opt(str()),
});

export type LedgerShowInput = Infer<typeof LedgerShowReq>;
export type LedgerAddInput = Infer<typeof LedgerAddReq>;
export type LedgerStatusInput = Infer<typeof LedgerStatusReq>;
export type MetricsImportInput = Infer<typeof MetricsImportReq>;

function assertBridgeOk<T extends { ok: boolean; code?: string; message?: string }>(res: T): T {
  if (!res.ok) {
    throw new AppError(
      res.code === "NOT_FOUND" ? "input.not_found" : "input.invalid",
      res.message || "台账操作失败",
      { code: res.code },
    );
  }
  return res;
}

export async function ledgerShowCommand(rawInput: unknown): Promise<LedgerShowResult> {
  const input = LedgerShowReq(rawInput);
  const bridge = createRulesBridge();
  const res = await bridge.ledgerShow({ ledger: input.ledgerPath, last: input.last });
  return assertBridgeOk(res);
}

export async function ledgerAddCommand(rawInput: unknown): Promise<LedgerMutateResult> {
  const input = LedgerAddReq(rawInput);
  const bridge = createRulesBridge();
  const res = await bridge.ledgerAdd({
    card: input.cardPath,
    ledger: input.ledgerPath,
    articleId: input.articleId,
    status: input.status,
    date: input.date,
  });
  return assertBridgeOk(res);
}

export async function ledgerStatusCommand(rawInput: unknown): Promise<LedgerMutateResult> {
  const input = LedgerStatusReq(rawInput);
  const bridge = createRulesBridge();
  const res = await bridge.ledgerStatus({
    title: input.title,
    to: input.to,
    ledger: input.ledgerPath,
    articleId: input.articleId,
  });
  return assertBridgeOk(res);
}

export async function metricsImportCommand(rawInput: unknown): Promise<LedgerMutateResult> {
  const input = MetricsImportReq(rawInput);
  const bridge = createRulesBridge();
  const res = await bridge.metricsImport({
    articleId: input.articleId,
    metricsJson: input.metricsJson,
    ledger: input.ledgerPath,
    url: input.url,
  });
  return assertBridgeOk(res);
}
