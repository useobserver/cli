// Pure-helper coverage for the config-as-code CLI (arg parsing + result
// rendering). Runtime-agnostic: uses node:test so it runs under `node --test`
// and `bun test` without any dependency install. The fetch/IO path in main()
// is exercised manually against a live API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, formatResult, formatApplyResponse, formatProblem, VERSION, DEFAULT_API_URL, resolveBaseUrl } from "../cli.mjs";

test("VERSION is a semver string", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test("parseArgs: apply with file + flags", () => {
  const a = parseArgs(["apply", "-f", "observer.yaml", "--dry-run", "--prune"]);
  assert.equal(a.cmd, "apply");
  assert.equal(a.file, "observer.yaml");
  assert.equal(a.dryRun, true);
  assert.equal(a.prune, true);
  assert.deepEqual(a.unknown, []);
});

test("parseArgs: accepts a positional file", () => {
  assert.equal(parseArgs(["apply", "observer.yaml"]).file, "observer.yaml");
});

test("parseArgs: export with --all + format + out", () => {
  const a = parseArgs(["export", "--all", "--format", "yaml", "-o", "out.yaml"]);
  assert.equal(a.cmd, "export");
  assert.equal(a.all, true);
  assert.equal(a.format, "yaml");
  assert.equal(a.out, "out.yaml");
});

test("parseArgs: collects unknown / typo'd flags instead of ignoring them", () => {
  const a = parseArgs(["apply", "--prnue", "foo.yaml"]);
  assert.equal(a.file, "foo.yaml");
  assert.equal(a.prune, false);
  assert.deepEqual(a.unknown, ["--prnue"]);
});

test("parseArgs: a value-flag refuses to swallow a following flag", () => {
  const a = parseArgs(["apply", "-f", "--dry-run"]);
  assert.equal(a.dryRun, true);
  assert.equal(a.file, null);
  assert.ok(a.unknown.some((u) => u.includes("-f")));
});

test("parseArgs: lone '-' is a valid stdin file marker, not unknown", () => {
  const a = parseArgs(["apply", "-f", "-"]);
  assert.equal(a.file, "-");
  assert.deepEqual(a.unknown, []);
});

test("formatResult: renders a validation-error result", () => {
  const out = formatResult({ errors: [{ path: "metrics[0].key", message: "missing" }] });
  assert.ok(out.includes("Config invalid (1 error)"));
  assert.ok(out.includes("metrics[0].key: missing"));
});

test("formatResult: plan summary with per-object lines (skips unchanged)", () => {
  const out = formatResult({
    dry_run: true,
    summary: { created: 1, updated: 1, unchanged: 1, pruned: 0 },
    diff: {
      metrics: [{ key: "m1", action: "create" }, { key: "m2", action: "unchanged" }],
      services: [{ key: "s1", action: "update" }],
      slos: [],
      pages: [],
    },
  });
  assert.ok(out.includes("Plan: 1 created, 1 updated, 1 unchanged"));
  assert.ok(out.includes("+ metric m1"));
  assert.ok(out.includes("~ service s1"));
  assert.ok(!out.includes("m2")); // unchanged hidden
});

test("formatResult: labels applied vs plan and shows pruned", () => {
  const out = formatResult({ dry_run: false, summary: { created: 0, updated: 0, unchanged: 0, pruned: 2 }, diff: {} });
  assert.ok(out.includes("Applied:"));
  assert.ok(out.includes("2 pruned"));
});

test("formatResult: counts existing metrics the document only references", () => {
  const out = formatResult({ dry_run: true, summary: { created: 0, updated: 0, unchanged: 2, referenced: 3 }, diff: {} });
  assert.ok(out.startsWith("Plan: 0 created, 0 updated, 2 unchanged, 3 existing referenced"));
  assert.ok(!formatResult({ dry_run: true, summary: { created: 1 }, diff: {} }).includes("referenced"));
});

test("formatResult: prints non-fatal warnings on plan and on validation errors", () => {
  const warnings = [{ path: "incidents", message: "incidents are not managed by config; manage incidents via the API" }];
  const plan = formatResult({ dry_run: true, summary: { created: 0, updated: 0, unchanged: 1 }, diff: {}, warnings });
  assert.ok(plan.startsWith("Plan:"));
  assert.ok(plan.includes("Warnings:\n  ! incidents: incidents are not managed by config"));
  const bad = formatResult({ errors: [{ path: "metrics[0].key", message: "missing" }], warnings });
  assert.ok(bad.includes("Config invalid (1 error)"));
  assert.ok(bad.includes("! incidents:"));
  assert.ok(!formatResult({ dry_run: true, summary: {}, diff: {}, warnings: [] }).includes("Warnings"));
});

test("resolveBaseUrl: defaults to the canonical https://use.observer host", () => {
  assert.equal(DEFAULT_API_URL, "https://use.observer");
  assert.equal(resolveBaseUrl(undefined), "https://use.observer");
  assert.equal(resolveBaseUrl(""), "https://use.observer");
});

test("resolveBaseUrl: OBSERVER_API_URL overrides, legacy api. host still accepted", () => {
  assert.equal(resolveBaseUrl("https://api.use.observer"), "https://api.use.observer");
  assert.equal(resolveBaseUrl("https://api.use.observer/"), "https://api.use.observer");
  assert.equal(resolveBaseUrl("http://localhost:3000//"), "http://localhost:3000");
});

test("formatApplyResponse: a 403 is the problem, not 'Config invalid' or 'Applied: 0'", () => {
  const out = formatApplyResponse(
    { ok: false, status: 403 },
    {
      title: "item_suspended_plan",
      status: 403,
      detail: "This configuration changes items that are suspended.",
      errors: [{ path: "metrics.api", message: "suspended" }],
    },
  );
  assert.ok(out.startsWith("Error 403: item_suspended_plan — This configuration changes items"));
  assert.ok(out.includes("metrics.api: suspended"));
  assert.ok(!out.includes("Config invalid"));
  assert.ok(!out.includes("Applied"));
});

test("formatApplyResponse: 429 says when to retry (body or Retry-After)", () => {
  assert.ok(formatApplyResponse({ ok: false, status: 429 }, { title: "rate_limited", status: 429, retry_after: 17 }).includes("retry after 17s"));
  assert.ok(formatApplyResponse({ ok: false, status: 429, retryAfter: "9" }, null).includes("retry after 9s"));
});

test("formatApplyResponse: 413 and a non-JSON 502 report the status", () => {
  assert.equal(
    formatApplyResponse({ ok: false, status: 413 }, { title: "payload_too_large", status: 413, detail: "config body exceeds 1 MB" }),
    "Error 413: payload_too_large — config body exceeds 1 MB",
  );
  assert.equal(formatApplyResponse({ ok: false, status: 502, statusText: "Bad Gateway" }, null), "Error 502: Bad Gateway");
});

test("formatApplyResponse: 422 config_invalid and success keep the old rendering", () => {
  const invalid = formatApplyResponse({ ok: false, status: 422 }, { title: "config_invalid", errors: [{ path: "x", message: "y" }] });
  assert.ok(invalid.includes("Config invalid (1 error)"));
  assert.ok(formatApplyResponse({ ok: true, status: 200 }, { dry_run: true, summary: { created: 1 } }).startsWith("Plan: 1 created"));
});

test("formatProblem: carries the upgrade link", () => {
  const out = formatProblem({ status: 403 }, { title: "quota_exceeded", upgrade: { label: "Pro", url: "https://use.observer/pricing" } });
  assert.ok(out.includes("Upgrade to Pro: https://use.observer/pricing"));
});
