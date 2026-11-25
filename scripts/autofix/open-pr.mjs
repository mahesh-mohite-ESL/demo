import { existsSync, statSync } from "node:fs";
import { applyPatch, commitAndPush, git, remoteBranchExists, stagedNumstat } from "./claude.mjs";
import {
  DRY_RUN,
  LABELS,
  addLabels,
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
  writeJson,
} from "./issues.mjs";

function handOver(stage, reason) {
  logIssue("warning", `The pull request was not opened: ${reason}`);
  writeJson("handover.json", { stage, reason, pushable: false, repro: readJson("result.json", {}).repro ?? null });
}

function body(bug, result, ctx) {
  const failing = (result.repro?.failedTests || []).map((t) => `- \`${t}\``).join("\n") || "- (none recorded)";
  const passed = (result.verification || []).map((c) => `- ${c}`).join("\n") || "- (none recorded)";
  const files = (result.change?.files || []).map((f) => `- \`${f}\``).join("\n");
  return [
    `<!-- claude-autofix:pr {"issue":${bug.id}} -->`,
    "Claude wrote this fix and a person must review it before it merges.",
    "",
    `Fixes #${bug.id}`,
    "",
    "### Root cause",
    result.fix?.rootCause || "",
    "",
    "### Change",
    result.fix?.summary || "",
    "",
    files,
    "",
    "### Evidence",
    "Tests that failed before the fix:",
    failing,
    "",
    "Checks that passed:",
    passed,
    "",
    `Attempts: ${result.fix?.attempts ?? 1} - cost: $${Number(result.costUsd ?? 0).toFixed(2)} - [workflow run](${ctx.buildUrl})`,
  ].join("\n");
}

async function main() {
  const result = readJson("result.json");
  const bug = readJson("bug.json");
  if (!result || result.status !== "fixed" || !bug) return;

  const patch = outPath("change.patch");
  if (!existsSync(patch) || statSync(patch).size === 0) {
    handOver("guardrail", "The patch is missing or empty.");
    return;
  }
  try {
    applyPatch("change.patch");
  } catch (error) {
    handOver("guardrail", `The patch does not apply: ${error.message}`);
    return;
  }
  const change = checkChange(stagedNumstat(), limitsFromEnv());
  if (!change.ok) {
    handOver("guardrail", change.violations.join("; "));
    return;
  }

  const ctx = context();
  const title = `Fix #${bug.id}: ${bug.title}`;
  const text = body(bug, result, ctx);
  if (DRY_RUN) {
    console.log(`[dry-run] ${title}\n\n${text}`);
    return;
  }
  if (process.env.HAS_AUTOFIX_TOKEN !== "true") {
    logIssue("warning", "AUTOFIX_TOKEN is not set, so the pull request will get no checks.");
  }

  let branch = bugBranch(bug.id);
  if (remoteBranchExists(branch)) branch = bugBranch(bug.id, process.env.GITHUB_RUN_ID || String(Date.now()));
  git(["checkout", "-B", branch]);
  const commit = commitAndPush(branch, title);
  const pr = await createPullRequest(ctx, {
    sourceBranch: branch,
    targetBranch: process.env.AUTOFIX_TARGET_BRANCH || "main",
    title,
    body: text,
    draft: false,
  });
  writeJson("pr.json", { id: pr.number, url: pr.html_url, branch, commit });
  await addLabels(ctx, pr.number, [LABELS.optIn]);
  await updateIssue(ctx, bug.id, { addLabels: [LABELS.prOpen], removeLabels: [LABELS.inProgress] });
  await postComment(ctx, bug.id, `Claude auto-fix opened pull request #${pr.number} for this issue. A person reviews and merges it.`);
  console.log(`Opened pull request #${pr.number}.`);
}

main().catch((error) => handOver("guardrail", `The pull request could not be created: ${error.message}`));
