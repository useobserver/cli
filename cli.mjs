#!/usr/bin/env node
// Observer config-as-code CLI — apply/export an Observer config document
// through the public API. Zero runtime dependencies (Node built-in fetch + fs).
//
//   observer apply  -f observer.yaml [--dry-run] [--prune]
//   observer export [--all] [--format yaml] [-o observer.yaml]
//   observer --version | --help
//
// Env:
//   OBSERVER_API_URL   base URL (default https://api.use.observer)
//   OBSERVER_API_KEY   obs_pub_… key with write:config / read:config
//
// Exit codes: 0 ok · 1 validation failure / error · 2 usage error.

import { readFileSync, writeFileSync } from "node:fs";
import pkg from "./package.json" with { type: "json" };

export const VERSION = pkg.version;

// Pure arg parser. Never throws / exits — collects unrecognized tokens into
// `unknown` so main() can reject them. Flags that consume a value refuse to
// swallow a following flag (so `apply -f --dry-run` is a usage error, not a
// readFileSync('--dry-run') ENOENT). `-` is the explicit stdin marker.
export function parseArgs(argv) {
  const a = { cmd: argv[0], file: null, out: null, dryRun: false, prune: false, all: false, format: "json", unknown: [] };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t === "-f" || t === "--file" || t === "-o" || t === "--out" || t === "--format") {
      const v = argv[i + 1];
      if (v === undefined || (v.startsWith("-") && v !== "-")) {
        a.unknown.push(`${t} (missing value)`);
        continue;
      }
      i++;
      if (t === "-f" || t === "--file") a.file = v;
      else if (t === "-o" || t === "--out") a.out = v;
      else a.format = v;
    } else if (t === "--dry-run") a.dryRun = true;
    else if (t === "--prune") a.prune = true;
    else if (t === "--all") a.all = true;
    else if (t === "-" || !t.startsWith("-")) {
      if (!a.file) a.file = t;
      else a.unknown.push(t);
    } else a.unknown.push(t);
  }
  return a;
}

// Human-readable rendering of an apply response. Pure (testable).
export function formatResult(json) {
  if (!json) return "no response";
  if (json.errors) {
    const lines = json.errors.map((e) => `  ✗ ${e.path}: ${e.message}`);
    return `Config invalid (${json.errors.length} error${json.errors.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
  }
  const s = json.summary ?? {};
  const head = `${json.dry_run ? "Plan" : "Applied"}: ${s.created ?? 0} created, ${s.updated ?? 0} updated, ${s.unchanged ?? 0} unchanged${s.pruned ? `, ${s.pruned} pruned` : ""}`;
  const detail = [];
  for (const [bucket, items] of Object.entries(json.diff ?? {})) {
    for (const it of items) {
      if (it.action === "unchanged") continue;
      const sym = it.action === "create" ? "+" : it.action === "prune" ? "-" : "~";
      detail.push(`  ${sym} ${bucket.replace(/s$/, "")} ${it.key}`);
    }
  }
  return detail.length ? `${head}\n${detail.join("\n")}` : head;
}

const HELP = `observer ${VERSION} — Observer config-as-code CLI

Usage:
  observer apply  -f <file> [--dry-run] [--prune]            apply (or plan) a config document
  observer export [--all] [--format yaml|json] [-o <file>]   dump current config
  observer --version                                         print version
  observer --help                                            print this help

Environment:
  OBSERVER_API_URL   API base URL (default https://api.use.observer)
  OBSERVER_API_KEY   obs_pub_… key with write:config / read:config

Exit codes: 0 ok · 1 validation/error · 2 usage error.`;

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

// version/help are only honored as the LEADING token. Matching them anywhere
// in argv would let `observer apply -f prod.yaml --version` print the version
// and exit 0 WITHOUT applying — a silent no-op apply that reads as success.
const isVersionToken = (t) => t === "version" || t === "--version" || t === "-v";
const isHelpToken = (t) => t === "help" || t === "--help" || t === "-h";

export async function main(argv = process.argv.slice(2)) {
  const first = argv[0];
  if (isVersionToken(first)) {
    console.log(VERSION);
    process.exit(0);
  }
  if (argv.length === 0) {
    console.log(HELP);
    process.exit(2);
  }
  if (isHelpToken(first)) {
    console.log(HELP);
    process.exit(0);
  }

  const args = parseArgs(argv);
  if (args.unknown.length) {
    console.error(`unrecognized argument(s): ${args.unknown.join(", ")}\n`);
    console.error(HELP);
    process.exit(2);
  }

  const base = env("OBSERVER_API_URL", "https://api.use.observer").replace(/\/$/, "");
  const key = env("OBSERVER_API_KEY");
  if (!key) {
    console.error("OBSERVER_API_KEY is not set");
    process.exit(2);
  }
  const authHeaders = { Authorization: `Bearer ${key}` };

  if (args.cmd === "apply") {
    const body = readFileSync(args.file ?? 0, "utf8"); // file or stdin
    const qs = new URLSearchParams();
    if (args.dryRun) qs.set("dryRun", "true");
    if (args.prune) qs.set("prune", "true");
    const res = await fetch(`${base}/api/v1/config/apply?${qs}`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "text/yaml" },
      body,
    });
    const json = await res.json().catch(() => null);
    console.log(formatResult(json));
    process.exit(res.ok ? 0 : 1);
  }

  if (args.cmd === "export") {
    const qs = new URLSearchParams();
    if (args.all) qs.set("all", "true");
    qs.set("format", args.format === "yaml" ? "yaml" : "json");
    const res = await fetch(`${base}/api/v1/config/export?${qs}`, { headers: authHeaders });
    if (!res.ok) {
      console.error(`export failed: ${res.status}`);
      process.exit(1);
    }
    const text = args.format === "yaml" ? await res.text() : JSON.stringify(await res.json(), null, 2);
    if (args.out) writeFileSync(args.out, text);
    else process.stdout.write(text.endsWith("\n") ? text : text + "\n");
    process.exit(0);
  }

  console.error(`unknown command: ${args.cmd}\n`);
  console.error(HELP);
  process.exit(2);
}

// Only run when invoked directly as `node cli.mjs` (so tests can import the pure
// helpers). The compiled binary + npx entry is bin.mjs, which calls main().
if (import.meta.url === `file://${process.argv[1]}`) main();
