/**
 * Minimal Markdown → HTML for manuscript reading. Every text run is escaped
 * before any markup is added, so author or model text can never inject tags;
 * only headings, paragraphs, blockquotes, rules, fenced code and inline
 * strong / em / code are recognised.
 */
export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function lightMdToHtml(md) {
  const text = String(md == null ? "" : md).replace(/\r\n?/g, "\n");
  if (!text.trim()) return "";
  const html = [];
  let para = [];
  let quote = [];
  let code = null;
  const flushPara = () => {
    if (!para.length) return;
    html.push("<p>" + inline(para.join("\n")).replace(/\n/g, "<br/>") + "</p>");
    para = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push("<blockquote>" + quote.map((line) => "<p>" + inline(line) + "</p>").join("") + "</blockquote>");
    quote = [];
  };
  const flush = () => {
    flushPara();
    flushQuote();
  };
  for (const line of text.split("\n")) {
    if (code !== null) {
      if (line.startsWith("```")) {
        html.push("<pre><code>" + code.map(escapeHtml).join("\n") + "</code></pre>");
        code = null;
      } else code.push(line);
      continue;
    }
    if (line.startsWith("```")) {
      flush();
      code = [];
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      html.push("<hr/>");
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      html.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushQuote();
    para.push(line);
  }
  flush();
  if (code !== null) html.push("<pre><code>" + code.map(escapeHtml).join("\n") + "</code></pre>");
  return html.join("");
}

/** Count CJK characters plus latin words, matching how authors read length. */
export function countChars(text) {
  const s = String(text || "");
  const cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (s.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}
