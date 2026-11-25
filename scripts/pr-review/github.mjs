import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OUT_DIR = "pr-review-output";
export const MARKER = "claude-review";
export const STATUS_CONTEXT = "claude/review";

export function ensureOutDir() {
  mkdirSync(OUT_DIR, { recursive: true });
}

export function outPath(name) {
  return join(OUT_DIR, name);
}

export function readJson(name, fallback) {
  const path = outPath(name);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(name, value) {
  ensureOutDir();
  writeFileSync(outPath(name), JSON.stringify(value, null, 2) + "\n");
}

export function writeText(name, value) {
  ensureOutDir();
  writeFileSync(outPath(name), value);
}

export function fingerprint(finding) {
  const file = String(finding.file ?? "").toLowerCase().replace(/\\/g, "/");
  const title = String(finding.title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha1").update(`${file}|${title}`).digest("hex").slice(0, 12);
}

export function prContext() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return null;
  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch {
    return null;
  }
  const pr = event.pull_request;
  if (!pr) return null;
  const repository = process.env.GITHUB_REPOSITORY;
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  return {
    api: `${apiBase}/repos/${repository}`,
    prId: pr.number,
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    targetBranch: pr.base?.ref,
    sourceBranch: pr.head?.ref,
    sourceCommit: pr.head?.sha,
    buildUrl: `${server}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  };
}

export async function gh(ctx, method, path, body) {
  const response = await fetch(`${ctx.api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "claude-pr-review",
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

export async function ghAll(ctx, path) {
  const items = [];
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= 10; page++) {
    const chunk = await gh(ctx, "GET", `${path}${separator}per_page=100&page=${page}`);
    items.push(...chunk);
    if (chunk.length < 100) break;
  }
  return items;
}

function escapeData(text) {
  return String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text) {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function logIssue(type, message, file, line) {
  const properties = [];
  if (file) properties.push(`file=${escapeProperty(file)}`);
  if (file && line) properties.push(`line=${escapeProperty(line)}`);
  const head = properties.length ? ` ${properties.join(",")}` : "";
  console.log(`::${type}${head}::${escapeData(message)}`);
}
