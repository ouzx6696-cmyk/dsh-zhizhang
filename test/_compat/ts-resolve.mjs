/**
 * Resolve hook for node:test runs against `src/*.ts`.
 *
 * The source is written for a bundler-ish resolver: internal imports say `./x.js`
 * while the file on disk is `./x.ts`. Bun rewrites that automatically; plain Node does
 * not. This hook maps `.js` → sibling `.ts` when the .ts exists, so the suite can run
 * on stock Node without touching 70+ source files.
 */
import { registerHooks } from "node:module";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".js") && (specifier.startsWith("./") || specifier.startsWith("../"))) {
      try {
        const url = new URL(specifier, context.parentURL);
        const file = fileURLToPath(url);
        const tsFile = file.slice(0, -3) + ".ts";
        if (fs.existsSync(tsFile)) {
          return { url: pathToFileURL(tsFile).href, shortCircuit: true };
        }
      } catch {
        /* fall through to default resolution */
      }
    }
    return nextResolve(specifier, context);
  },
});
