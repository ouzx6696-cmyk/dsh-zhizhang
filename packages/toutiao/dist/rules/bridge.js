import path from "node:path";
import { runPythonJson } from "@zhizhang/core/python";
function parseStyleCatalog(markdown) {
    const byLine = {};
    const openingSet = new Set();
    const endingSet = new Set();
    for (const rawLine of markdown.split(/\r?\n/)) {
        const match = /^-\s*([^：]+)：.*开头式\s+([^；\n]+)；结尾式\s+([^；\n]+)/.exec(rawLine.trim());
        if (!match)
            continue;
        const lineName = match[1].trim();
        const openings = match[2]
            .split("、")
            .map((s) => s.trim())
            .filter(Boolean);
        const endings = match[3]
            .split("、")
            .map((s) => s.trim())
            .filter(Boolean);
        byLine[lineName] = { openings, endings };
        for (const op of openings)
            openingSet.add(op);
        for (const ed of endings)
            endingSet.add(ed);
    }
    return {
        byLine,
        allOpenings: [...openingSet],
        allEndings: [...endingSet],
    };
}
export function createRulesBridge(scriptsDir) {
    const bridgeScript = path.join(scriptsDir, "writer_bridge.py");
    const qaScript = path.join(scriptsDir, "qa_check.py");
    return {
        limits() {
            return runPythonJson(bridgeScript, ["limits"]);
        },
        async styles() {
            const res = await runPythonJson(bridgeScript, ["rules"]);
            return parseStyleCatalog(res.markdown ?? "");
        },
        checkCard(cardPath) {
            return runPythonJson(qaScript, [
                "--card",
                cardPath,
                "--json",
            ]);
        },
        async qa(args) {
            const cmd = ["qa", "--file", args.file];
            if (args.card)
                cmd.push("--card", args.card);
            if (args.ledger)
                cmd.push("--ledger", args.ledger);
            if (args.mode)
                cmd.push("--mode", args.mode);
            if (args.articleId)
                cmd.push("--article-id", args.articleId);
            const raw = await runPythonJson(bridgeScript, cmd);
            return {
                ...raw,
                overall: raw.overall ?? raw.score ?? 0,
                passed: raw.passed ?? raw.pass ?? false,
            };
        },
        ledgerShow(args) {
            const cmd = ["ledger-show", "--ledger", args.ledger];
            if (args.last !== undefined)
                cmd.push("--last", String(args.last));
            return runPythonJson(bridgeScript, cmd);
        },
        ledgerAdd(args) {
            const cmd = ["ledger-add", "--card", args.card, "--ledger", args.ledger];
            if (args.articleId)
                cmd.push("--article-id", args.articleId);
            if (args.status)
                cmd.push("--status", args.status);
            if (args.date)
                cmd.push("--date", args.date);
            return runPythonJson(bridgeScript, cmd);
        },
        ledgerStatus(args) {
            const cmd = ["ledger-status", "--title", args.title, "--to", args.to, "--ledger", args.ledger];
            if (args.articleId)
                cmd.push("--article-id", args.articleId);
            return runPythonJson(bridgeScript, cmd);
        },
        metricsImport(args) {
            const cmd = [
                "metrics-import",
                "--article-id",
                args.articleId,
                "--metrics-json",
                args.metricsJson,
                "--ledger",
                args.ledger,
            ];
            if (args.url)
                cmd.push("--url", args.url);
            return runPythonJson(bridgeScript, cmd);
        },
    };
}
