import { jsonOutput, list, locate, record, text, type Draft } from "./schema";
import type { WorkflowRun } from "./run";

/** One fact-chain pass: every external claim with its source evidence, or marked unsupported. */
export function factChain(
  run: WorkflowRun,
  id: string,
  card: string,
  body: Draft,
  source: { text: string },
) {
  const line = run.journal.record.request.line;
  return run.model(
    id,
    "核对事实与原文",
    "editor",
    card,
    { draft: body, source },
    '逐条列出正文中的外部事实或原典引文及其来源证据。返回 {"claims":[{"claim":"正文原文","quote":"来源原文；无来源时为空","kind":"fact或quotation或fiction或unsupported"}]}。没有来源的事实标 unsupported，不能省略；fiction只用于已明确标注的故事演绎。',
    (value) => {
      const claims = list(jsonOutput(value).claims, "事实链", 100).map((raw) => {
        const r = record(raw),
          kind = String(r.kind),
          claim = locate(body.body, text(r.claim, "正文声明"));
        if (claim === undefined) throw new Error("事实链引用的正文不在当前稿中");
        if (!["fact", "quotation", "fiction", "unsupported"].includes(kind))
          throw new Error("事实分类无效");
        if (kind === "fiction" && line !== "story") throw new Error("资讯稿不得标为故事演绎");
        if (kind === "unsupported") return { claim, quote: "", kind };
        const quote = locate(source.text, text(r.quote, "来源证据"));
        if (quote === undefined) throw new Error("事实链的来源证据不在来源原文中");
        return { claim, quote, kind };
      });
      if (!claims.length) throw new Error("未提供可核对的事实链");
      return { claims };
    },
  );
}
