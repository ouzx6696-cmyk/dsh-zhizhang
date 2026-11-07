/** handoff.v2 方法注入：会话内去重、预算裁剪与 writer-method 块组装，prompt.ts 的 v2 路径专用。 */
import type { TaskMethod } from "./task-methods";

/** 写章与 S 步方法包的全文预算（≈12k 汉字）；超出按 TRIM_ORDER 整份裁剪。 */
const METHOD_PACK_BUDGET_BYTES = 36000;

/** 超预算裁剪序：先 prose 病型表、再 rhythm 三档节奏；不在表内的方法（write-chapter 本体、S 步主方法、规划与修订）永不裁。 */
const TRIM_ORDER = ["prose", "rhythm"];

const packBytes = (methods: Pick<TaskMethod, "text">[]) =>
  methods.reduce((sum, method) => sum + Buffer.byteLength(method.text), 0);

/** 纯函数：在 limit 内保序保留全文注入的方法，其余整份裁出；裁剪只发生在任务单级，不动方法文件。 */
function budgetPlan(methods: TaskMethod[], limit: number) {
  const full = [...methods];
  const trimmed: TaskMethod[] = [];
  for (const id of TRIM_ORDER) {
    if (packBytes(full) <= limit) break;
    const index = full.findIndex((method) => method.id === id);
    if (index >= 0) trimmed.push(...full.splice(index, 1));
  }
  return { full, trimmed };
}

/** writer-context JSON 里 methods 凭据区的三种行：本次全文 / 去重不重发 / 预算裁剪说明。 */
type MethodCredential =
  | { id: string; profile: string; hash: string }
  | { id: string; profile: string; hash: string; injected: true }
  | { id: string; profile: string; hash: string; note: string };

interface MethodInjection {
  credentials: MethodCredential[];
  /** writer-method 纯文本块，按方法包顺序拼在 writer-context 之后 */
  blocks: string[];
  /** 本次以全文附上的方法（handoff.methodIds / methodBytes；去重与裁剪的都不在其中） */
  injectedIds: string[];
  injectedBytes: number;
  /** 预算裁剪的方法 id（handoff.trimmedIds，无裁剪为空） */
  trimmedIds: string[];
}

/** v2 注入决策：先按该会话已注入凭据去重（同 id 同 hash 不重发全文），再对本次要发的全文做预算裁剪。 */
export function planMethodInjection(
  methods: TaskMethod[],
  prior: ReadonlyMap<string, { id: string; profile: string; hash: string }> | undefined,
  mode: "fanqie" | "toutiao",
): MethodInjection {
  const deduped = methods.filter((method) => prior?.get(method.id)?.hash === method.hash);
  const plan = budgetPlan(
    methods.filter((method) => prior?.get(method.id)?.hash !== method.hash),
    METHOD_PACK_BUDGET_BYTES,
  );
  const dedupedIds = new Set(deduped.map((method) => method.id));
  const trimmedIds = new Set(plan.trimmed.map((method) => method.id));
  const tool = mode === "fanqie" ? "fanqie_method_get" : "toutiao_method_get";
  return {
    credentials: methods.map((method) =>
      dedupedIds.has(method.id)
        ? { id: method.id, profile: method.profile, hash: method.hash, injected: true as const }
        : trimmedIds.has(method.id)
          ? {
              id: method.id,
              profile: method.profile,
              hash: method.hash,
              note: `预算裁剪：${method.id} 未随交接附上，需要时 ${tool} 读取`,
            }
          : { id: method.id, profile: method.profile, hash: method.hash },
    ),
    blocks: plan.full.map(
      (method) =>
        `<writer-method id="${method.id}" hash="${method.hash}">${method.text}</writer-method>`,
    ),
    injectedIds: plan.full.map((method) => method.id),
    injectedBytes: packBytes(plan.full),
    trimmedIds: plan.trimmed.map((method) => method.id),
  };
}
