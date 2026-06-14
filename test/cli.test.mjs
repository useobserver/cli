// Pure-helper coverage for the config-as-code CLI (arg parsing + result
// rendering). Runtime-agnostic: uses node:test so it runs under `node --test`
// and `bun test` without any dependency install. The fetch/IO path in main()
// is exercised manually against a live API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, formatResult, VERSION } from "../cli.mjs";

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
