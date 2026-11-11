import { emptyUsage } from "../../../../packages/core/src/workflow";
import { CLASSICS } from "../../../../packages/toutiao/src/classics";
import { readSource } from "../network";
import { record, text } from "./schema";
import type { WorkflowRun } from "./run";

/**
 * 准备来源：作者素材原样使用；故事线可取本地原典；资讯线可读给定链接。
 * 不凭空抓取新闻，没有真实来源就报错。
 */
export async function articleSource(run: WorkflowRun) {
  const request = run.journal.record.request;
  return run.journal.step(
    "sources",
    "准备来源",
    {
      parse: (value) => {
        const r = record(value);
        return { text: text(r.text, "来源原文"), attribution: text(r.attribution, "来源说明") };
      },
    },
    async () => {
      let material = request.source.trim(),
        attribution = "作者提供的素材";
      if (request.line === "story" && !material) {
        const classic = CLASSICS.find((item) => request.instruction.includes(item.title));
        if (!classic)
          throw new Error("本地原典库没有匹配题材，请选择内置原典或提供原文；不消耗新闻抓取额度");
        material = classic.text;
        attribution = classic.source;
      } else if (/^https?:\/\/\S+$/.test(material)) {
        if (request.line === "story")
          throw new Error("故事线请提供原文或选择本地原典，不抓取新闻链接");
        const value = await readSource(material, run.signal);
        material = value.text;
        attribution = value.url + " " + value.date;
      }
      if (!material) throw new Error("资讯与微头条需要真实来源原文或链接");
      return { value: { text: material, attribution }, usage: emptyUsage() };
    },
    run.signal,
    0,
  );
}
