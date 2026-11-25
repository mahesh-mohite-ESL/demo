import { ghAll, prContext, writeJson, writeText } from "./github.mjs";

const MARKER_PATTERN = /<!--\s*claude-review:finding\s+(\{.*?\})\s*-->/s;

async function main() {
  const ctx = prContext();
  if (!ctx) {
    writeJson("prior_findings.json", []);
    writeText("prior_findings.txt", "");
    return;
  }
  const comments = [
    ...(await ghAll(ctx, `/pulls/${ctx.prId}/comments`)),
    ...(await ghAll(ctx, `/issues/${ctx.prId}/comments`)),
  ];
  const findings = [];
  const seen = new Set();
  for (const comment of comments) {
    const match = MARKER_PATTERN.exec(comment.body || "");
    if (!match) continue;
    try {
      const finding = JSON.parse(match[1]);
      if (finding.fp && seen.has(finding.fp)) continue;
      if (finding.fp) seen.add(finding.fp);
      findings.push(finding);
    } catch {
      // ignore a marker that is not valid JSON
    }
  }
  writeJson("prior_findings.json", findings);
  writeText(
    "prior_findings.txt",
    findings.map((f) => `- [${f.severity}] ${f.file}:${f.line} - ${f.title}`).join("\n") + (findings.length ? "\n" : ""),
  );
  console.log(`Loaded ${findings.length} prior finding(s).`);
}

main().catch((error) => {
  console.log(`::warning::Could not load prior findings: ${String(error.message).replace(/\n/g, " ")}`);
  writeJson("prior_findings.json", []);
  writeText("prior_findings.txt", "");
});
