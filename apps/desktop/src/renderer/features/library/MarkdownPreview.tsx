import React from "react";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/** 安全渲染 GFM Markdown 逻辑结构预览（经 rehype-sanitize 过滤，零裸 HTML 注入）。 */
export function MarkdownPreview({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={`zz-md-preview ${className}`.trim()} data-testid="markdown-preview">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </Markdown>
    </div>
  );
}
