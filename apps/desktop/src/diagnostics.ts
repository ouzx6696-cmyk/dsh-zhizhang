import { errorText } from "../../../packages/core/src/errors.js";
import { taskEndCopy } from "../../../packages/ui/src/copy.js";
export { Diagnostics } from "../../../packages/core/src/diagnostics";
export function explainError(error: unknown) {
  const text = errorText(error);
  if (/401|invalid.*key|authentication|unauthorized/i.test(text))
    return "模型认证失败：请检查服务商、接口地址和 API Key。";
  if (/402|quota|insufficient|balance|credit/i.test(text))
    return "模型额度不足：请检查服务商账户余额和额度。";
  if (/429|rate.?limit|too many requests/i.test(text))
    return "请求过于频繁：请稍后重试，或在服务商调整限额。";
  if (/ENOTFOUND|ECONN|fetch failed|network|timeout|timed out/i.test(text))
    return "网络连接失败或超时：请检查接口地址、网络和代理后重试。";
  if (/abort/i.test(text)) return taskEndCopy("cancelled");
  return text;
}
