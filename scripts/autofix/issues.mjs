import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OUT_DIR = "autofix-output";
export const MARKER = "claude-autofix";
export const DRY_RUN = process.env.AUTOFIX_DRY_RUN === "1";
export const LABELS = {
  optIn: "claude-autofix",
  inProgress: "claude-in-progress",
  prOpen: "claude-pr-open",
  needsHuman: "claude-needs-human",
};

export function outPath(name) {
  return join(OUT_DIR, name);
}

export function readJson(name, fallback = null) {
  const path = outPath(name);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(name, value) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(outPath(name), JSON.stringify(value, null, 2) + "\n");
}

export function writeText(name, value) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(outPath(name), value);
}

export function logIssue(type, message) {
  const text = String(message).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::${type}::${text}`);
}

export function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  else console.log(`output ${name}=${value}`);
}

export function labelNames(item) {
  return (item.labels || []).map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean);
}

export function hasLabel(item, label) {
  return labelNames(item).some((name) => name.toLowerCase() === label.toLowerCase());
}

export function isEligible(issue) {
  return (
    issue.state === "open" &&
    !issue.pull_request &&
    hasLabel(issue, LABELS.optIn) &&
    !hasLabel(issue, LABELS.inProgress) &&
    !hasLabel(issue, LABELS.prOpen) &&
    !hasLabel(issue, LABELS.needsHuman)
  );
}

export function isTestFile(file) {
  return /^tests\/[\w./-]+$/.test(file) && !file.includes("..");
}

export function isPytestModule(file) {
  return isTestFile(file) && /^test_.*\.py$/.test(file.split("/").pop());
}

export function checkChange(numstat, { allowed = ["app/", "tests/"], maxLines = 300 } = {}) {
  const violations = [];
  const files = [];
  let lines = 0;
  for (const row of String(numstat).split("\n").filter((r) => r.trim())) {
    const [added, removed, ...rest] = row.split("\t");
    const file = rest.join("\t");
    files.push(file);
    if (added === "-" || removed === "-") {
      violations.push(`${file}: binary files are not allowed`);
      continue;
    }
    lines += Number(added) + Number(removed);
    if (file.includes("=>") || file.includes("..") || !allowed.some((prefix) => file.startsWith(prefix))) {
      violations.push(`${file}: this path may not be changed`);
      continue;
    }
    if (file.startsWith("tests/") && Number(removed) !== 0) {
      violations.push(`${file}: existing test lines were removed or changed`);
    }
  }
  if (lines > maxLines) violations.push(`${lines} changed lines exceed the limit of ${maxLines}`);
  return { ok: violations.length === 0, violations, files, lines };
}

export function failedTests(xml) {
  const names = [];
  const cases = String(xml).match(/<testcase\b[^>]*?(?:\/>|>[\s\S]*?<\/testcase>)/g) || [];
  for (const block of cases) {
    if (!/<failure\b/.test(block)) continue;
    const classname = /classname="([^"]*)"/.exec(block)?.[1] ?? "";
    const name = /\bname="([^"]*)"/.exec(block)?.[1] ?? "";
    names.push(`${classname}::${name}`);
  }
  return names;
}

export function limitsFromEnv() {
  const allowed = (process.env.AUTOFIX_ALLOWED_PATHS || "app/,tests/")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const maxLines = Number(process.env.AUTOFIX_MAX_CHANGED_LINES || 300);
  return { allowed, maxLines };
}

export function bugBranch(issueNumber, suffix = "") {
  return `autofix/issue-${issueNumber}${suffix ? `-${suffix}` : ""}`;
}

export function bugIdFromBranch(ref) {
  const match = /^(?:refs\/heads\/)?autofix\/issue-(\d+)(?:-.*)?$/.exec(String(ref));
  return match ? Number(match[1]) : null;
}

export function context() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set.");
  if (!token) throw new Error("GH_TOKEN (or GITHUB_TOKEN) is not set.");
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  return {
    repo,
    token,
    api: `${apiBase}/repos/${repo}`,
    buildUrl: `${server}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  };
}

export async function api(ctx, method, path, body) {
  if (DRY_RUN && method !== "GET") {
    console.log(`[dry-run] ${method} ${path}`);
    return null;
  }
  const response = await fetch(`${ctx.api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "claude-autofix",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(`GitHub ${method} ${path} failed with status ${response.status}: ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function listAll(ctx, path) {
  const items = [];
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= 20; page++) {
    const chunk = await api(ctx, "GET", `${path}${separator}per_page=100&page=${page}`);
    items.push(...chunk);
    if (chunk.length < 100) break;
  }
  return items;
}

export function getIssue(ctx, number) {
  return api(ctx, "GET", `/issues/${number}`);
}

export async function findEligibleIssues(ctx) {
  const issues = await listAll(ctx, `/issues?state=open&labels=${encodeURIComponent(LABELS.optIn)}&sort=created&direction=asc`);
  return issues
    .filter(isEligible)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export async function countProcessed(ctx) {
  let total = 0;
  for (const label of [LABELS.prOpen, LABELS.needsHuman]) {
    const issues = await listAll(ctx, `/issues?state=all&labels=${encodeURIComponent(label)}`);
    total += issues.filter((issue) => !issue.pull_request).length;
  }
  return total;
}

export function bugSummary(issue) {
  return {
    id: issue.number,
    title: issue.title,
    description: issue.body || "",
    author: issue.user?.login || "",
    webUrl: issue.html_url,
  };
}

export function postComment(ctx, number, body) {
  return api(ctx, "POST", `/issues/${number}/comments`, { body });
}

export function addLabels(ctx, number, labels) {
  return api(ctx, "POST", `/issues/${number}/labels`, { labels });
}

export async function updateIssue(ctx, number, { addLabels: add = [], removeLabels = [], assignee, comment } = {}) {
  if (add.length) await addLabels(ctx, number, add);
  for (const label of removeLabels) {
    try {
      await api(ctx, "DELETE", `/issues/${number}/labels/${encodeURIComponent(label)}`);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  if (assignee) await api(ctx, "POST", `/issues/${number}/assignees`, { assignees: [assignee] });
  if (comment) await postComment(ctx, number, comment);
}

export async function claimIssue(ctx, issue, note) {
  const current = await getIssue(ctx, issue.number);
  if (!isEligible(current)) return false;
  await addLabels(ctx, issue.number, [LABELS.inProgress]);
  await postComment(ctx, issue.number, note);
  return true;
}

export function createPullRequest(ctx, { sourceBranch, targetBranch, title, body, draft = false }) {
  return api(ctx, "POST", "/pulls", { head: sourceBranch, base: targetBranch, title, body, draft });
}
