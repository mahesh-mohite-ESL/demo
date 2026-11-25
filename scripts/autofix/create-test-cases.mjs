import { MARKER, context, logIssue, postComment, readJson, writeJson } from "./issues.mjs";

function clean(text) {
  return String(text ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/</g, "&lt;")
    .trim();
}

async function main() {
  const bug = readJson("bug.json");
  if (!bug) return;
  const result = readJson("result.json", {});
  const handover = readJson("handover.json", {});
  const repro = result.repro || handover.repro;
  if (!repro) {
    console.log("The bug was not reproduced, so there are no test cases to post.");
    return;
  }

  const cases = (repro.testCases || []).slice(0, 10);
  const failing = (repro.failedTests || []).length;
  const lines = [
    `<!-- ${MARKER}:test-cases -->`,
    "### Test cases for this bug",
    "",
    `Reproducing files: ${(repro.files || []).map((f) => `\`${clean(f)}\``).join(", ") || "none"}`,
    `Failing tests before the fix: ${failing}`,
    "",
  ];
  for (const testCase of cases) {
    lines.push(`- [ ] **${clean(testCase.title)}**`);
    (testCase.steps || []).forEach((step, index) => lines.push(`  ${index + 1}. ${clean(step)}`));
    lines.push(`  - Expected: ${clean(testCase.expected)}`);
    lines.push(`  - Automated test: ${clean(testCase.automated_test)}`);
  }
  writeJson("test-cases.json", cases);
  await postComment(context(), bug.id, lines.join("\n"));
  console.log(`Posted ${cases.length} test case(s) on #${bug.id}.`);
}

main().catch((error) => logIssue("warning", `Could not post the test cases: ${error.message}`));
