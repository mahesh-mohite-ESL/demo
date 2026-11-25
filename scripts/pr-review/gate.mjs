import { logIssue, readJson } from "./github.mjs";

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

const review = readJson("findings.json", null);
if (!review) {
  logIssue("error", "findings.json is missing, so the review did not complete.");
  process.exit(1);
}

const findings = review.findings || [];
console.log(`Verdict: ${review.verdict}`);
for (const severity of SEVERITIES) {
  console.log(`${severity}: ${findings.filter((f) => f.severity === severity).length}`);
}

const blockingSeverities = (process.env.REVIEW_FAIL_ON || "critical")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const blocking = findings.filter((f) => blockingSeverities.includes(f.severity));
if (blocking.length > 0) {
  logIssue("error", `Merge blocked: ${blocking.length} finding(s) with severity ${blockingSeverities.join(", ")}.`);
  process.exit(1);
}
console.log("The review gate passed.");
