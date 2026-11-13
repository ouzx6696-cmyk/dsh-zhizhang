import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

function MarkdownView({ text, onLink }: { text: string; onLink?: (href: string) => void }) {
  const components = React.useMemo<Components>(
    () => ({
      a: ({ href, children }) => (
        <a
          href={href}
          target={onLink ? undefined : "_blank"}
          rel="noreferrer"
          onClick={(event) => {
            if (onLink && href) {
              event.preventDefault();
              onLink(href);
            }
          }}
        >
          {children}
        </a>
      ),
    }),
    [onLink],
  );
  return (
    <div className="ui-markdown">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        skipHtml
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = React.memo(MarkdownView);
