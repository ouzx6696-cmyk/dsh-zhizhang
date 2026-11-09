/**
 * 渲染层内容安全策略，只此一份。生产窗口经 loadFile 走 file://，响应头对它不生效，
 * 所以构建时把它写进 index.html 的 meta；开发服务器需要 HMR 的 websocket 与本机地址，
 * 由主进程以响应头下发放宽版。开发模式不注入 meta，否则会拦掉 react-refresh 的内联脚本。
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:", // Vite inlines small woff2 subsets as data: URLs
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join("; ");

export const DEV_CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY.replace(
  "connect-src 'self'",
  "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
);
