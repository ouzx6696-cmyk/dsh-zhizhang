import { errorText } from "./errors.js";
/**
 * 门禁引擎。
 *
 * 两层防线：
 * 1. tools/pre-execute 门禁：调用到达工具前给出 deny / ask（ask 由宿主审批服务弹给作者）。
 * 2. 工具内复核：要求"作者确认"的工具在执行时调用 consumeConfirmation()，
 *    只有门禁确实为本次调用（exec.token）发起过 ask 并获放行，工具才继续。
 *    这样即便宿主没接上门禁（或接口变化导致门禁静默失效），也不会绕过作者确认。
 */
import type { ToolExecution, PreToolDecision } from "./tool.js";

export type GateOutcome =
  { kind: "deny"; reason: string } | { kind: "ask"; reason: string } | undefined;

export interface GateRule {
  id: string;
  /** 适用工具名；以 * 结尾表示前缀匹配（如 fanqie_*） */
  tool: string;
  /** true：作者配置不能关闭 */
  locked: boolean;
  description: string;
  check(args: Record<string, unknown>, exec: ToolExecution): Promise<GateOutcome> | GateOutcome;
}

export interface GateConfig {
  /** 关闭的非锁定规则 id */
  disabled?: string[];
  requireApproval?: boolean;
}

export interface GateEngine {
  readonly rules: readonly GateRule[];
  evaluate(exec: ToolExecution): Promise<PreToolDecision | undefined>;
  /** 工具内调用：本次调用是否已由门禁 ask 并被作者放行。调用即消费。 */
  consumeConfirmation(exec: ToolExecution, ruleId: string): boolean;
  confirmationArguments(exec: ToolExecution): Record<string, unknown> | undefined;
  approveConfirmation(exec: ToolExecution): void;
  discardConfirmation(exec: ToolExecution): void;
  /** 测试/诊断用：某规则当前是否生效 */
  isActive(ruleId: string): boolean;
}

/** 规则的工具名匹配：精确，或 `前缀*` */
function toolMatches(pattern: string, name: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

const ASK_TTL_MS = 30 * 60 * 1000;

export function createGateEngine(rules: GateRule[], config: GateConfig = {}): GateEngine {
  const disabled = new Set(
    (config.disabled ?? []).filter((id) => !rules.find((r) => r.id === id)?.locked),
  );
  const active = rules.filter((r) => !disabled.has(r.id));
  /** token → {ruleIds, at}；token 是宿主为每次调用分配的唯一 symbol */
  const asked = new Map<
    symbol,
    {
      ruleIds: Set<string>;
      at: number;
      input: string;
      approved: boolean;
      arguments: Record<string, unknown>;
    }
  >();

  function sweep(now: number) {
    for (const [k, v] of asked) if (now - v.at > ASK_TTL_MS) asked.delete(k);
  }

  return {
    rules: active,
    isActive: (id) => active.some((r) => r.id === id),
    async evaluate(exec) {
      if (exec.token) asked.delete(exec.token);
      const matching = active.filter((r) => toolMatches(r.tool, exec.name));
      if (matching.length === 0) return undefined;
      const args = (
        exec.arguments && typeof exec.arguments === "object" ? { ...exec.arguments } : {}
      ) as Record<string, unknown>;
      const asks: GateRule[] = [];
      const reasons: string[] = [];
      for (const rule of matching) {
        let outcome: GateOutcome;
        try {
          outcome = await rule.check(args, exec);
          // allow-catch: gate failures return an explicit deny with the error, never authorization.
        } catch (err) {
          // 门禁自身出错按拒绝处理（失败即关闭）
          return {
            kind: "deny",
            reason: `门禁 ${rule.id} 检查出错：${errorText(err)}`,
            info: { name: "WriterGate", code: "GATE_ERROR" },
          };
        }
        if (!outcome) continue;
        if (outcome.kind === "deny") {
          return {
            kind: "deny",
            reason: `【门禁 ${rule.id}】${outcome.reason}`,
            info: { name: "WriterGate", code: "GATE_DENIED" },
          };
        }
        asks.push(rule);
        reasons.push(outcome.reason);
      }
      if (asks.length === 0) return undefined;
      if (exec.token) {
        const now = Date.now();
        sweep(now);
        asked.set(exec.token, {
          ruleIds: new Set(asks.map((r) => r.id)),
          at: now,
          input: JSON.stringify([exec.name, exec.arguments]),
          approved: !config.requireApproval,
          arguments: args,
        });
      }
      const text = reasons.join("；");
      return { kind: "ask", reason: text, displayReason: { en: text, "zh-CN": text, zh: text } };
    },
    confirmationArguments(exec) {
      const rec = exec.token ? asked.get(exec.token) : undefined;
      return rec?.approved &&
        Date.now() - rec.at <= ASK_TTL_MS &&
        rec.input === JSON.stringify([exec.name, exec.arguments])
        ? { ...rec.arguments }
        : undefined;
    },
    approveConfirmation(exec) {
      if (exec.token) {
        const rec = asked.get(exec.token);
        if (rec) rec.approved = true;
      }
    },
    discardConfirmation(exec) {
      if (exec.token) asked.delete(exec.token);
    },
    consumeConfirmation(exec, ruleId) {
      if (!exec.token) return false;
      const rec = asked.get(exec.token);
      if (
        !rec ||
        !rec.approved ||
        Date.now() - rec.at > ASK_TTL_MS ||
        rec.input !== JSON.stringify([exec.name, exec.arguments]) ||
        !rec.ruleIds.has(ruleId)
      )
        return false;
      rec.ruleIds.delete(ruleId);
      if (rec.ruleIds.size === 0) asked.delete(exec.token);
      return true;
    },
  };
}
