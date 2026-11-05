import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

/**
 * @param {{ text: string, onLink?: (href: string) => void }} props
 */
function MarkdownView({ text, onLink }) {
  const components = React.useMemo(
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
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = React.memo(MarkdownView);
