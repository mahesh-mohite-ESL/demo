import assert from "node:assert/strict";
import test from "node:test";
import { scrubbedEnv } from "./claude.mjs";
import { bugBranch, bugIdFromBranch, checkChange, failedTests, isEligible, isPytestModule, isTestFile } from "./issues.mjs";

const issue = (overrides = {}) => ({ state: "open", labels: [{ name: "claude-autofix" }], ...overrides });

test("isEligible accepts an open issue with the opt-in label", () => {
  assert.equal(isEligible(issue()), true);
  assert.equal(isEligible(issue({ labels: ["Claude-Autofix"] })), true);
});

test("isEligible rejects closed issues, pull requests and issues without the label", () => {
  assert.equal(isEligible(issue({ state: "closed" })), false);
  assert.equal(isEligible(issue({ pull_request: {} })), false);
  assert.equal(isEligible(issue({ labels: [{ name: "bug" }] })), false);
});

test("isEligible rejects issues that are already handled", () => {
  for (const name of ["claude-in-progress", "claude-pr-open", "claude-needs-human"]) {
    assert.equal(isEligible(issue({ labels: [{ name: "claude-autofix" }, { name }] })), false, name);
  }
});

test("checkChange accepts a small change under app/ and tests/", () => {
  const result = checkChange("3\t1\tapp/normalize.py\n10\t0\ttests/test_normalize.py\n");
  assert.equal(result.ok, true);
  assert.equal(result.lines, 14);
  assert.deepEqual(result.files, ["app/normalize.py", "tests/test_normalize.py"]);
});

test("checkChange rejects workflow, script, configuration and dependency changes", () => {
  for (const file of [".github/workflows/ci-review.yml", "scripts/autofix/issues.mjs", "pyproject.toml", "requirements.txt", "samples/index.json"]) {
    assert.equal(checkChange(`1\t1\t${file}\n`).ok, false, file);
  }
});

test("checkChange rejects binary, renamed and oversized changes", () => {
  assert.equal(checkChange("-\t-\tapp/logo.png\n").ok, false);
  assert.equal(checkChange("0\t0\tapp/{old.py => new.py}\n").ok, false);
  assert.equal(checkChange("200\t101\tapp/big.py\n").ok, false);
  assert.equal(checkChange("150\t150\tapp/big.py\n").ok, true);
});

test("checkChange lets tests grow but rejects removed lines there", () => {
  assert.equal(checkChange("40\t0\ttests/test_api.py\n").ok, true);
  const result = checkChange("5\t2\ttests/test_api.py\n");
  assert.equal(result.ok, false);
  assert.match(result.violations[0], /existing test lines were removed or changed/);
});

test("checkChange rejects paths with .. in them", () => {
  assert.equal(checkChange("1\t0\tapp/../secrets.py\n").ok, false);
});

test("isTestFile and isPytestModule", () => {
  assert.equal(isTestFile("tests/test_api.py"), true);
  assert.equal(isTestFile("tests/fixtures/acme-usd.json"), true);
  assert.equal(isTestFile("app/main.py"), false);
  assert.equal(isTestFile("tests/../app/main.py"), false);
  assert.equal(isPytestModule("tests/test_api.py"), true);
  assert.equal(isPytestModule("tests/conftest.py"), false);
  assert.equal(isPytestModule("tests/fixtures/test_data.json"), false);
});

test("failedTests lists failed tests only", () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite>
    <testcase classname="tests.test_a" name="test_fails"><failure message="x">boom</failure></testcase>
    <testcase classname="tests.test_a" name="test_passes"/>
    <testcase classname="tests.test_b" name="test_collection"><error message="import error">x</error></testcase>
  </testsuite></testsuites>`;
  assert.deepEqual(failedTests(xml), ["tests.test_a::test_fails"]);
});

test("scrubbedEnv drops credentials and runner files, keeps what is listed", () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    GH_TOKEN: "t",
    ANTHROPIC_API_KEY: "k",
    MY_SECRET: "s",
    DEPLOY_PAT: "p",
    DB_PASSWORD: "d",
    GITHUB_OUTPUT: "/tmp/out",
    GITHUB_ENV: "/tmp/env",
    HARMLESS: "ok",
  });
  try {
    const env = scrubbedEnv();
    for (const name of ["GH_TOKEN", "ANTHROPIC_API_KEY", "MY_SECRET", "DEPLOY_PAT", "DB_PASSWORD", "GITHUB_OUTPUT", "GITHUB_ENV"]) {
      assert.equal(env[name], undefined, name);
    }
    assert.equal(env.HARMLESS, "ok");
    assert.equal(env.CI, "true");
    assert.equal(scrubbedEnv(["ANTHROPIC_API_KEY"]).ANTHROPIC_API_KEY, "k");
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test("bugBranch and bugIdFromBranch", () => {
  assert.equal(bugBranch(7), "autofix/issue-7");
  assert.equal(bugBranch(7, "123"), "autofix/issue-7-123");
  assert.equal(bugIdFromBranch("autofix/issue-7"), 7);
  assert.equal(bugIdFromBranch("refs/heads/autofix/issue-7-123"), 7);
  assert.equal(bugIdFromBranch("feature/x"), null);
});
