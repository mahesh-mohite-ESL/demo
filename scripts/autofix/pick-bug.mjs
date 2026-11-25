import {
  LABELS,
  bugSummary,
  claimIssue,
  context,
  countProcessed,
  findEligibleIssues,
  getIssue,
  hasLabel,
  logIssue,
  postComment,
  setOutput,
  updateIssue,
  writeJson,
} from "./issues.mjs";

async function main() {
  const ctx = context();
  const note = `Claude auto-fix picked up this issue. [Workflow run](${ctx.buildUrl})`;

  const maxRuns = Number(process.env.AUTOFIX_MAX_RUNS || 0);
  if (maxRuns > 0) {
    const processed = await countProcessed(ctx);
    if (processed >= maxRuns) {
      logIssue("warning", `The limit of ${maxRuns} processed issue(s) is reached (${processed}), so no issue is picked.`);
      setOutput("hasBug", "false");
      return;
    }
  }

  const requested = Number(process.env.AUTOFIX_ISSUE || 0);
  let issue = null;
  if (requested > 0) {
    issue = await getIssue(ctx, requested);
    if (issue.state !== "open" || issue.pull_request) {
      logIssue("error", `#${requested} is not an open issue.`);
      process.exit(1);
    }
    if (hasLabel(issue, LABELS.inProgress) || hasLabel(issue, LABELS.prOpen)) {
      logIssue("error", `#${requested} is already being handled or has a pull request.`);
      process.exit(1);
    }
    await updateIssue(ctx, requested, {
      addLabels: [LABELS.optIn, LABELS.inProgress],
      removeLabels: [LABELS.needsHuman],
    });
    await postComment(ctx, requested, note);
  } else {
    const candidates = await findEligibleIssues(ctx);
    for (const candidate of candidates) {
      if (await claimIssue(ctx, candidate, note)) {
        issue = candidate;
        break;
      }
    }
  }

  if (!issue) {
    console.log("No eligible issue found.");
    setOutput("hasBug", "false");
    return;
  }
  writeJson("bug.json", bugSummary(issue));
  setOutput("hasBug", "true");
  setOutput("issue", String(issue.number));
  console.log(`Picked issue #${issue.number}: ${issue.title}`);
}

main().catch((error) => {
  logIssue("error", error.message);
  process.exit(1);
});
