import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR, ensureOutDir, logIssue, outPath, prContext, writeJson, writeText } from "./github.mjs";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: result.status, out: (result.stdout || "").trim(), err: (result.stderr || "").trim() };
}

function launcher() {
  const dir = process.env.CLAUDE_CODE_PACKAGE_DIR;
  if (dir) {
    const bin = join(dir, "bin", process.platform === "win32" ? "claude.exe" : "claude");
    if (existsSync(bin)) return { command: bin, prefix: [] };
    return { command: process.execPath, prefix: [join(dir, "cli.js")] };
  }
  return { command: "claude", prefix: [] };
}

function normaliseFinding(finding) {
  const severities = ["critical", "high", "medium", "low", "info"];
  const severity = String(finding.severity ?? "").trim().toLowerCase();
  const line = Number.parseInt(finding.line, 10);
  return {
    severity: severities.includes(severity) ? severity : "info",
    category: String(finding.category ?? "").trim(),
    file: String(finding.file ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, ""),
    line: Number.isInteger(line) && line > 0 ? line : 0,
    title: String(finding.title ?? "").trim(),
    description: String(finding.description ?? "").trim(),
    suggestion: String(finding.suggestion ?? "").trim(),
  };
}

function parseReview(output) {
  if (output.structured_output && typeof output.structured_output === "object") return output.structured_output;
  const text = String(output.result ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function main() {
  ensureOutDir();
  if (!process.env.ANTHROPIC_API_KEY) {
    logIssue("error", "ANTHROPIC_API_KEY is not set, so the review cannot run.");
    process.exit(1);
  }

  const ctx = prContext();
  const base = ctx?.targetBranch || process.env.REVIEW_BASE_BRANCH || "main";
  const prNumber = ctx?.prId ?? "local";
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

  if (git(["rev-parse", "--verify", "--quiet", `origin/${base}`]).status !== 0) {
    git(["fetch", "origin", `${base}:refs/remotes/origin/${base}`]);
  }
  const mergeBase = git(["merge-base", `origin/${base}`, "HEAD"]).out;
  if (!mergeBase) {
    logIssue("error", `Could not find the merge base with origin/${base}.`);
    process.exit(1);
  }
  const files = git(["diff", "--name-only", mergeBase, "HEAD"]).out.split("\n").filter(Boolean);
  writeText("changed_files.txt", files.join("\n") + (files.length ? "\n" : ""));
  const diff = git(["diff", mergeBase, "HEAD", "--", ".", ":(exclude)samples/*.pdf"]).out;
  writeText("pr.diff", diff + "\n");

  const meta = { model, prId: prNumber, baseBranch: base, mergeBase, cost_usd: 0, turns: 0 };
  if (files.length === 0) {
    writeJson("findings.json", { summary: "No changes to review.", verdict: "approve", findings: [], meta });
    console.log("No changes to review.");
    return;
  }

  const prior = existsSync(outPath("prior_findings.txt")) ? readFileSync(outPath("prior_findings.txt"), "utf8").trim() : "";
  const inline = diff.length <= 120000;
  const prompt = [
    `You are the automated reviewer for pull request #${prNumber} targeting ${base}.`,
    `Follow the "PR review guidelines" section of CLAUDE.md exactly.`,
    ``,
    `Changed files:`,
    files.map((f) => `- ${f}`).join("\n"),
    ``,
    `Findings already posted on this pull request. Do not report these again:`,
    prior || "(none)",
    ``,
    `Answer with structured output that matches the provided JSON schema.`,
    ``,
    inline
      ? `Diff:\n\`\`\`diff\n${diff}\n\`\`\``
      : `The diff is too long to include here. Read it from ${OUT_DIR}/pr.diff.`,
    ``,
  ].join("\n");
  writeText("prompt.txt", prompt);

  const schema = JSON.stringify(JSON.parse(readFileSync(".claude/review_schema.json", "utf8")));
  const { command, prefix } = launcher();
  const args = [
    ...prefix,
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    schema,
    "--model",
    model,
    "--max-budget-usd",
    String(process.env.CLAUDE_MAX_BUDGET_USD || "2"),
    "--allowedTools",
    "Read Grep Glob Bash(git diff *) Bash(git log *) Bash(git show *)",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];
  const env = { ...process.env, CI: "true" };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;

  const result = spawnSync(command, args, { input: prompt, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  writeText("claude_stdout.json", result.stdout || "");
  writeText("claude_stderr.txt", result.stderr || "");
  if (result.error) {
    logIssue("error", `Claude Code could not be started: ${result.error.message}`);
    process.exit(1);
  }

  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    logIssue("error", "Claude Code returned no JSON output.");
    process.exit(1);
  }
  if (output.is_error) {
    logIssue("error", `Claude Code reported an error: ${String(output.result ?? "").slice(0, 300)}`);
    process.exit(1);
  }
  const review = parseReview(output);
  if (!review) {
    logIssue("error", "The review answer of Claude could not be read.");
    process.exit(1);
  }

  const findings = (Array.isArray(review.findings) ? review.findings : []).map(normaliseFinding);
  const verdicts = ["approve", "comment", "request_changes"];
  writeJson("findings.json", {
    summary: String(review.summary ?? "").trim(),
    verdict: verdicts.includes(review.verdict) ? review.verdict : "comment",
    findings,
    meta: { ...meta, cost_usd: output.total_cost_usd ?? 0, turns: output.num_turns ?? 0 },
  });
  for (const f of findings) console.log(`[${f.severity}] ${f.file}:${f.line} - ${f.title}`);
  console.log(`Review finished with ${findings.length} finding(s).`);
}

main();
