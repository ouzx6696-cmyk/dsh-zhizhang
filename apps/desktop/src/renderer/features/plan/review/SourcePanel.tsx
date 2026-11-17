import React from "react";
import { P } from "../shared";
export function SourcePanel({
  text,
  quote,
  onRead,
}: {
  text: string;
  quote: string;
  onRead(): void;
}) {
  const at = quote ? text.indexOf(quote) : -1;
  return (
    <>
      <h4>{P["plan.source"]}</h4>
      <pre
        data-testid="proposal-source"
        onScroll={(event) => {
          if (
            event.currentTarget.scrollTop + event.currentTarget.clientHeight >=
            event.currentTarget.scrollHeight - 5
          )
            onRead();
        }}
      >
        {at < 0 ? (
          text || P["plan.noQuote"]
        ) : (
          <>
            {text.slice(0, at)}
            <mark>{quote}</mark>
            {text.slice(at + quote.length)}
          </>
        )}
      </pre>
    </>
  );
}
