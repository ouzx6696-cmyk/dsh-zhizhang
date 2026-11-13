/** Shared classification for provider status, balance, and rate-limit messages. */
export function classifyProviderMessage(message: string) {
  const status = Number(/^\s*(\d{3})\b/.exec(message)?.[1] ?? 0);
  if (status === 401 || status === 403) return "auth";
  if (
    /insufficient[ _]balance|insufficient[ _]quota|exceeded your current quota|exceeded[ _]current[ _]quota|credit balance is too low|arrearage|out of budget|payment required|余额不足|欠费/i.test(
      message,
    )
  )
    return "balance";
  if (
    /rate[ _-]?limit|resource[ _]exhausted|throttl|too many requests|per[ _-]?(?:minute|second|hour|day)|requests? per|tokens? per|\b[RT]PM\b|限流|频率|请求过于频繁/i.test(
      message,
    )
  )
    return "rate";
  if (status === 402 || /quota[ _]exceeded|exceeded[ _].*quota/i.test(message)) return "balance";
  if (status === 429) return "rate";
  if (/invalid.*key|authentication|unauthorized/i.test(message)) return "auth";
  if (status === 408 || status >= 500) return "transient";
  return status >= 400 ? "provider" : undefined;
}
