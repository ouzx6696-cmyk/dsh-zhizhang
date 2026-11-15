import React from "react";
import { Markdown as MarkdownView } from "@zhizhang/ui/markdown";
import { desktopApi } from "./bridge";

export const Markdown = React.memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="studio-markdown">
      <MarkdownView text={text} onLink={(href: string) => void desktopApi.openExternal(href)} />
    </div>
  );
});
