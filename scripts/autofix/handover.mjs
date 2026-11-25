import { existsSync, statSync } from "node:fs";
import { applyPatch, commitAndPush, git, stagedNumstat } from "./claude.mjs";
import {
  DRY_RUN,
  LABELS,
  MARKER,
  bugBranch,
  checkChange,
  context,
  createPullRequest,
  limitsFromEnv,
  logIssue,
  outPath,
  postComment,
  readJson,
  updateIssue,
} from "./issues.mjs";

async function draftPullRequest(ctx, bug, handover) {
  const patch = outPath("change.patch");
  if (!handover.pushable || !existsSync(patch) || statSync(patch).size === 0) return null;
  try {
    git(["reset", "--hard"]);
    applyPatch("change.patch");
    const change = checkChange(stagedNumstat(), limitsFromEnv());
    if (!change.ok) {
      logIssue("warning", `The unfinished work breaks the guardrail: ${change.violations.join("; ")}`);
      return null;
    }
    const branch = bugBranch(bug.id, `draft-${process.env.GITHUB_RUN_ID || Date.now()}`);
    git(["checkout", "-B", branch]);
    commitAndPush(branch, `Unfinished work for #${bug.id}`);
    if (DRY_RUN) return null;
    const pr = await createPullRequest(ctx, {
      sourceBranch: branch,
      targetBranch: process.env.AUTOFIX_TARGET_BRANCH || "main",
      title: `[Needs human] #${bug.id}: ${bug.title}`,
      body: `Unfinished work from Claude auto-fix for #${bug.id}. It needs a person to finish it.\n\nFixes #${bug.id}`,
      draft: true,
    });
    return pr;
  } catch (error) {
    logIssue("warning", `Could not open the draft pull request: ${error.message}`);
    return null;
  }
}

async function main() {
  const bug = readJson("bug.json");
  if (!bug) return;
  const result = readJson("result.json");
  const handover = readJson("handover.json");
  const pr = readJson("pr.json");
  if (result?.status === "fixed" && (pr || DRY_RUN) && !handover) return;

  const stage = handover?.stage || result?.stage || "pipeline";
  const reason =
    handover?.reason ||
    (result?.status === "fixed"
      ? "the fix was verified but the pull request could not be created"
      : "the workflow stopped before the fix was complete");
  const repro = handover?.repro || result?.repro;

  const ctx = context();
  const draft = await draftPullRequest(ctx, bug, handover || {});

  const lines = [
    `<!-- ${MARKER}:handover -->`,
    "**Claude auto-fix could not finish this issue and is handing it over to a person.**",
    "",
    `- Stopped at: ${stage}`,
    `- Reason: ${reason}`,
    `- Reproduction: ${
      repro
        ? `the bug was reproduced${repro.failedTests?.length ? ` (failing: ${repro.failedTests.join(", ")})` : ""}`
        : "the bug was not reproduced"
    }`,
    `- [Workflow run](${ctx.buildUrl})`,
  ];
  if (draft) lines.push(`- Draft pull request: #${draft.number}`);
  lines.push("", "To let the automation try again, remove the label claude-needs-human.");

  await postComment(ctx, bug.id, lines.join("\n"));
  const assignee = process.env.AUTOFIX_HANDOVER_TO;
  const update = { addLabels: [LABELS.needsHuman], removeLabels: [LABELS.inProgress] };
  try {
    await updateIssue(ctx, bug.id, { ...update, assignee });
  } catch (error) {
    if (!assignee) throw error;
    logIssue("warning", `Could not assign ${assignee}: ${error.message}`);
    await updateIssue(ctx, bug.id, update);
  }
}

main().catch((error) => logIssue("warning", `The handover failed: ${error.message}`));
