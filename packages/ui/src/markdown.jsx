import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export function Markdown({text,onLink}) {
  return <div className="ui-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml components={{a:({href,children}) => <a href={href} target={onLink ? undefined : "_blank"} rel="noreferrer" onClick={event => {if(onLink && href){event.preventDefault();onLink(href);}}}>{children}</a>}}>{text}</ReactMarkdown></div>;
}
