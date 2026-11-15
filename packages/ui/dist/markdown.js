import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];
function MarkdownView({ text, onLink }) {
    const components = React.useMemo(() => ({
        a: ({ href, children }) => (_jsx("a", { href: href, target: onLink ? undefined : "_blank", rel: "noreferrer", onClick: (event) => {
                if (onLink && href) {
                    event.preventDefault();
                    onLink(href);
                }
            }, children: children })),
    }), [onLink]);
    return (_jsx("div", { className: "ui-markdown", children: _jsx(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS, rehypePlugins: REHYPE_PLUGINS, skipHtml: true, components: components, children: text }) }));
}
export const Markdown = React.memo(MarkdownView);
