import path from "node:path";
import { readMethod } from "../../../../packages/core/src/profiles";
import { atomicWrite, readJson, sha256 } from "../../../../packages/core/src/fsx";
import { fanqieLibrary } from "../../../../packages/fanqie/src/forge";
import { toutiaoLibrary } from "../../../../packages/toutiao/src/methods";
import { jsonOutput, list, record, text } from "./schema";
import type { Sessions } from "../session/manager";
import type { WorkflowRequest } from "../../../../packages/core/src/workflow";
import type { WorkflowRun } from "./run";

interface Rule {
  id: string;
  text: string;
}
interface Card {
  sourceHash: string;
  rules: Rule[];
}
/** Default/original/user profiles remain the only method source; generated cards have no independent editable copy. */
export async function stageCard(run: WorkflowRun, mode: "fanqie" | "toutiao", id: string) {
  const method = await readMethod(
    mode === "fanqie" ? fanqieLibrary : toutiaoLibrary,
    undefined,
    id,
    run.host.options[mode]?.profile,
  );
  const sourceHash = sha256(method.text);
  const sections = method.text
    .split(/\n(?=##\s)/)
    .filter((section) => section.trim())
    .map((section, index) => ({ id: `${id}:${index + 1}`, text: section }));
  const ids = sections.map((section) => section.id);
  const parse = (value: unknown): Card => {
    const r = jsonOutput(value),
      rules = list(r.rules, "阶段规则", 100).map((value) => {
        const rule = record(value);
        return { id: text(rule.id, "规则号", 120), text: text(rule.text, "执行规则", 1500) };
      });
    if (
      r.sourceHash !== sourceHash ||
      rules.length !== ids.length ||
      new Set(rules.map((rule) => rule.id)).size !== ids.length ||
      ids.some((id) => !rules.some((rule) => rule.id === id))
    )
      throw new Error("阶段卡规则覆盖与方法来源不一致");
    if ([...rules.map((rule) => rule.text).join("\n")].length > 1500)
      throw new Error("阶段卡超过 1500 字，请压缩表达而不删规则");
    return { sourceHash, rules };
  };
  const file = path.join(run.host.home, "stage-cards", sourceHash + ".json");
  const cached = await readJson<unknown>(file);
  const card =
    cached === undefined
      ? await run.model(
          `method-${sourceHash.slice(0, 16)}`,
          "准备阶段方法",
          "planner",
          "保留每一节的因果、禁止事项与边界，去掉工具调用和文件操作指令。",
          { sourceHash, sections },
          '将各节压为可执行规则；每节对应一项、编号不变，所有规则文字合计不超过1500字。返回 {"sourceHash":"原指纹","rules":[{"id":"原编号","text":"执行规则"}]}。',
          parse,
        )
      : parse(cached);
  if (cached === undefined) await atomicWrite(file, JSON.stringify(card, null, 2));
  const examples = sections
    .filter((section) => /反例|正例|例如/.test(section.text) && section.text.length <= 1200)
    .slice(0, 2);
  return [
    card.rules.map((rule) => `[${rule.id}] ${rule.text}`).join("\n"),
    ...examples.map(
      (section) => `参考病例（${section.id}，按本章适用条件选用）：\n${section.text}`,
    ),
  ].join("\n\n");
}

export async function methodBasis(host: Sessions, request: WorkflowRequest) {
  const mode = request.kind === "article" ? "toutiao" : "fanqie";
  const ids =
    request.kind === "book"
      ? ["plan-foundation", "plan-outline"]
      : request.kind === "chapter"
        ? ["plan-outline", "write-chapter", "edit", "revise"]
        : request.kind === "ledger"
          ? []
          : [
              "s2-selection",
              "s3-headline",
              request.line === "story"
                ? "s4-story"
                : request.line === "micro"
                  ? "s4-micro"
                  : "s4-news",
              "s5-editing",
            ];
  return Promise.all(
    ids.map(async (id) => {
      const value = await readMethod(
        mode === "fanqie" ? fanqieLibrary : toutiaoLibrary,
        undefined,
        id,
        host.options[mode]?.profile,
      );
      return { id, hash: sha256(value.text) };
    }),
  );
}
