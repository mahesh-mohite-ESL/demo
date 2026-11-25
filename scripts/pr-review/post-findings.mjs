import { MARKER, STATUS_CONTEXT, fingerprint, gh, logIssue, prContext, readJson } from "./github.mjs";

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

function failOn() {
  return (process.env.REVIEW_FAIL_ON || "critical")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function setStatus(ctx, state, description) {
  await gh(ctx, "POST", `/statuses/${ctx.sourceCommit}`, {
    state,
    context: STATUS_CONTEXT,
    description: description.slice(0, 140),
    target_url: ctx.buildUrl,
  });
}

function findingBody(finding, fp) {
  const marker = JSON.stringify({ fp, severity: finding.severity, file: finding.file, line: finding.line, title: finding.title });
  const lines = [
    `<!-- ${MARKER}:finding ${marker} -->`,
    `**[${finding.severity.toUpperCase()}] ${finding.title}**`,
    ``,
    `${finding.category} - ${finding.file}:${finding.line}`,
    ``,
    finding.description,
  ];
  if (finding.suggestion) lines.push(``, `**Suggested fix:** ${finding.suggestion}`);
  return lines.join("\n");
}

async function postFinding(ctx, finding, body) {
  if (finding.line > 0) {
    try {
      await gh(ctx, "POST", `/pulls/${ctx.prId}/comments`, {
        body,
        commit_id: ctx.sourceCommit,
        path: finding.file,
        line: finding.line,
        side: "RIGHT",
      });
      return;
    } catch (error) {
      if (error.status !== 422) throw error;
    }
  }
  await gh(ctx, "POST", `/issues/${ctx.prId}/comments`, { body });
}

async function main() {
  const ctx = prContext();
  if (!ctx) return;

  const review = readJson("findings.json", null);
  if (!review) {
    await gh(ctx, "POST", `/issues/${ctx.prId}/comments`, {
      body: `## Claude PR Review\n\nThe review did not complete. See the [workflow run](${ctx.buildUrl}) for details.`,
    });
    await setStatus(ctx, "error", "The review did not complete");
    return;
  }

  const findings = review.findings || [];
  for (const f of findings) {
    const blocking = f.severity === "critical" || f.severity === "high";
    logIssue(blocking ? "error" : "warning", `${f.title}: ${f.description}`, f.file, f.line);
  }

  const prior = readJson("prior_findings.json", []);
  const known = new Set(prior.map((p) => p.fp));
  const fresh = [];
  for (const f of findings) {
    const fp = fingerprint(f);
    if (!known.has(fp)) {
      known.add(fp);
      fresh.push({ finding: f, fp });
    }
  }
  const skipped = findings.length - fresh.length;

  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  const meta = review.meta || {};
  const summary = [
    `<!-- ${MARKER}:summary -->`,
    `## Claude PR Review`,
    ``,
    `**Verdict:** ${review.verdict}`,
    ``,
    review.summary || "",
    ``,
    `| Severity | Count |`,
    `|---|---|`,
    ...SEVERITIES.map((s) => `| ${s} | ${counts[s]} |`),
    ``,
    `Skipped as duplicates: ${skipped}`,
    ``,
    `Model: ${meta.model ?? "unknown"} - cost: $${Number(meta.cost_usd ?? 0).toFixed(2)} - [workflow run](${ctx.buildUrl})`,
  ].join("\n");
  await gh(ctx, "POST", `/issues/${ctx.prId}/comments`, { body: summary });

  for (const { finding, fp } of fresh) {
    try {
      await postFinding(ctx, finding, findingBody(finding, fp));
    } catch (error) {
      logIssue("warning", `Could not post a finding: ${error.message}`);
    }
  }

  const blocking = findings.filter((f) => failOn().includes(f.severity)).length;
  if (blocking > 0) await setStatus(ctx, "failure", `${blocking} blocking finding(s)`);
  else await setStatus(ctx, "success", "No blocking findings");
}

main().catch((error) => {
  logIssue("warning", `Posting the review failed: ${error.message}`);
});
