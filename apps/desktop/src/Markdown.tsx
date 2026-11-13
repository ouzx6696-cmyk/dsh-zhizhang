import React from "react";
import { Markdown as MarkdownView } from "@writer/ui/markdown";
import { desktop } from "./renderer/state/desktop";
export const Markdown = React.memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="studio-markdown">
      <MarkdownView text={text} onLink={(href: string) => void desktop.openExternal(href)} />
    </div>
  );
});
