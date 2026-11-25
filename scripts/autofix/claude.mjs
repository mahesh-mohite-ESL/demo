import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR, outPath, writeText } from "./issues.mjs";

const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|CREDENTIAL|(^|_)PAT$/i;
const RUNNER_FILES = ["GITHUB_ENV", "GITHUB_PATH", "GITHUB_OUTPUT", "GITHUB_STATE", "GITHUB_STEP_SUMMARY"];

export function scrubbedEnv(keep = []) {
  const env = { ...process.env, CI: "true" };
  for (const name of Object.keys(env)) {
    if (!keep.includes(name) && SECRET_NAME.test(name)) delete env[name];
  }
  for (const name of RUNNER_FILES) delete env[name];
  return env;
}

export function git(args, { allowFail = false, env } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8", env: env ?? scrubbedEnv(), maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || result.error?.message || "").trim().slice(0, 500)}`);
  }
  return (result.stdout || "").trim();
}

export function gitRemote(args) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("No token is available for the git remote.");
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  const env = {
    ...scrubbedEnv(),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
  return git(args, { env });
}

export function sh(command) {
  const result = spawnSync(command, { shell: true, encoding: "utf8", env: scrubbedEnv(), maxBuffer: 256 * 1024 * 1024 });
  return { status: result.status ?? 1, output: `${result.stdout || ""}${result.stderr || ""}` };
}

export function tail(text, chars = 4000) {
  const value = String(text ?? "");
  return value.length > chars ? value.slice(-chars) : value;
}

export function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function stagedNumstat(base = "HEAD") {
  git(["add", "-A"]);
  return git(["diff", "--cached", "--numstat", base]);
}

export function stagedPatch(base = "HEAD") {
  git(["add", "-A"]);
  const result = spawnSync("git", ["diff", "--cached", "--binary", base], {
    encoding: "utf8",
    env: scrubbedEnv(),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("git diff failed");
  return result.stdout;
}

export function applyPatch(name) {
  git(["apply", "--index", "--whitespace=nowarn", `${OUT_DIR}/${name}`]);
}

export function remoteBranchExists(branch) {
  return gitRemote(["ls-remote", "--heads", "origin", branch]).length > 0;
}

export function commitAndPush(branch, message) {
  git(["add", "-A"]);
  git(["-c", "user.name=Claude Autofix", "-c", "user.email=claude-autofix@users.noreply.github.com", "commit", "-m", message]);
  gitRemote(["push", "origin", `HEAD:refs/heads/${branch}`]);
  return git(["rev-parse", "HEAD"]);
}

function launcher() {
  const dir = process.env.CLAUDE_CODE_PACKAGE_DIR;
  if (dir) {
    const names = process.platform === "win32" ? ["claude.exe"] : ["claude", "claude.exe"];
    for (const name of names) {
      const bin = join(dir, "bin", name);
      if (existsSync(bin)) return { command: bin, prefix: [] };
    }
    const cli = join(dir, "cli.js");
    if (existsSync(cli)) return { command: process.execPath, prefix: [cli] };
    const linked = join(dir, "..", "..", ".bin", process.platform === "win32" ? "claude.cmd" : "claude");
    if (existsSync(linked)) return { command: linked, prefix: [] };
  }
  return { command: "claude", prefix: [] };
}

export function runClaude({ label, prompt, schemaPath, allowedTools, budgetUsd, model }) {
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    const chosenModel = model || process.env.AUTOFIX_MODEL || "claude-opus-5-5";
    writeText(`${label}_prompt.txt`, prompt);
    const schema = JSON.stringify(JSON.parse(readFileSync(schemaPath, "utf8")));
    const { command, prefix } = launcher();
    const args = [
      ...prefix,
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      schema,
      "--model",
      chosenModel,
      "--max-budget-usd",
      String(budgetUsd),
      "--allowedTools",
      allowedTools,
      "--disable-slash-commands",
      "--no-session-persistence",
    ];
    const env = { ...scrubbedEnv(["ANTHROPIC_API_KEY"]), CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" };
    const result = spawnSync(command, args, { input: prompt, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    writeFileSync(outPath(`${label}_stdout.json`), result.stdout || "");
    writeFileSync(outPath(`${label}_stderr.txt`), result.stderr || "");
    if (result.error) return { ok: false, structured: null, costUsd: 0, turns: 0, error: `Claude Code could not be started: ${result.error.message}` };
    let output;
    try {
      output = JSON.parse(result.stdout);
    } catch {
      const detail = (result.stderr || result.stdout || "").trim().slice(-400) || "(no output)";
      return { ok: false, structured: null, costUsd: 0, turns: 0, error: `Claude Code returned no JSON output (exit ${result.status}). ${detail}` };
    }
    const costUsd = Number(output.total_cost_usd ?? 0);
    const turns = Number(output.num_turns ?? 0);
    if (output.is_error) {
      return { ok: false, structured: null, costUsd, turns, error: `Claude Code reported an error: ${String(output.result ?? "").slice(0, 300)}` };
    }
    let structured = output.structured_output ?? null;
    if (!structured) {
      const text = String(output.result ?? "");
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try {
          structured = JSON.parse(text.slice(start, end + 1));
        } catch {
          structured = null;
        }
      }
    }
    if (!structured) return { ok: false, structured: null, costUsd, turns, error: "The answer of Claude could not be read." };
    return { ok: true, structured, costUsd, turns, error: null };
  } catch (error) {
    return { ok: false, structured: null, costUsd: 0, turns: 0, error: String(error.message ?? error) };
  }
}

export const CHECKS = [
  ["lint", "python -m ruff check ."],
  ["tests", "python -m pytest"],
];

export function verifyAll(label) {
  const passed = [];
  for (const [name, command] of CHECKS) {
    const result = sh(command);
    writeText(`${label}_${name}.log`, result.output);
    if (result.status !== 0) {
      return { ok: false, passed, failed: name, command, output: tail(result.output) };
    }
    passed.push(name);
  }
  return { ok: true, passed };
}

const BASE_TOOLS = ["Read", "Grep", "Glob", '"Bash(python -m pytest)"', '"Bash(python -m pytest *)"', '"Bash(git diff *)"', '"Bash(git status *)"', '"Edit(tests/**)"', '"Write(tests/**)"'];
export const REPRO_TOOLS = BASE_TOOLS.join(" ").replace(/"/g, "");
export const EDIT_TOOLS = [...BASE_TOOLS, '"Edit(app/**)"', '"Write(app/**)"', '"Bash(python -m ruff check *)"'].join(" ").replace(/"/g, "");

export function fixLoop({ label, promptFor, checkChange, protectedHashes = {}, budget, maxAttempts = 2 }) {
  let feedback = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const left = budget.total - budget.spent;
    if (left < 0.25) {
      return { ok: false, stage: "budget", reason: "The budget is used up.", pushable: false };
    }
    const run = runClaude({
      label: `${label}_${attempt}`,
      prompt: promptFor(feedback),
      schemaPath: ".claude/autofix_fix_schema.json",
      allowedTools: EDIT_TOOLS,
      budgetUsd: left.toFixed(2),
    });
    budget.spent += run.costUsd;
    if (!run.ok) {
      return { ok: false, stage: "fix", reason: run.error, pushable: false };
    }
    const change = checkChange(stagedNumstat());
    if (!change.ok) {
      return { ok: false, stage: "guardrail", reason: change.violations.join("; "), pushable: false };
    }
    for (const [file, hash] of Object.entries(protectedHashes)) {
      if (!existsSync(file) || sha256(file) !== hash) {
        return { ok: false, stage: "guardrail", reason: `The reproduction test ${file} was changed.`, pushable: false };
      }
    }
    const fix = run.structured;
    if (change.files.length === 0 || !fix.fixed) {
      return { ok: false, stage: "fix", reason: fix.root_cause || fix.summary || "Claude did not fix the bug.", pushable: change.files.length > 0 };
    }
    const verification = verifyAll(`${label}_${attempt}_verify`);
    if (verification.ok) {
      return { ok: true, fix, change, verification, attempts: attempt };
    }
    feedback = verification;
    if (attempt === maxAttempts) {
      return {
        ok: false,
        stage: "verify",
        reason: `The check "${verification.command}" still fails after ${attempt} attempt(s).`,
        pushable: true,
      };
    }
  }
  return { ok: false, stage: "verify", reason: "No attempt was made.", pushable: false };
}
