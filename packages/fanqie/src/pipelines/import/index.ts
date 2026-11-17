/**
 * 导入流水线（docmap → extract → locate → resolve → propose）。
 * A-02 只冻结请求契约与注册点；阶段实现归 I-02。
 */
import { AppError } from "@zhizhang/core/errors";
import type { DeliveryReceipt, PipelineDefinition, RunRecord } from "@zhizhang/core/pipeline";
import { arr, int, obj, str, type Infer } from "@zhizhang/core/schema";

export const ImportReq = obj({
  batch: str({ min: 1, max: 200 }),
  sections: arr(str({ min: 1, max: 60 })),
  estimate: obj({ inputMax: int({ min: 0 }), outputMax: int({ min: 0 }) }),
});

export type ImportInput = Infer<typeof ImportReq>;

export interface ImportResult {
  batch: string;
  failedChunks: number[];
}

function pending(): never {
  throw new AppError("internal", "未实现：I-02");
}

export const importPipeline: PipelineDefinition<ImportInput, ImportResult> = {
  kind: "fanqie.import",
  request: ImportReq,
  async context(target, req) {
    return { runId: `import-${Date.now()}`, target, request: req, state: {} };
  },
  async run() {
    return pending();
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    return {
      runId: ctx.runId,
      deliveredPaths: [],
      contentHash: "",
      summary: `导入未完成（${res.batch}）`,
    };
  },
  async recover(_record: RunRecord): Promise<"resume"> {
    return "resume";
  },
};
