#!/usr/bin/env node
// Entry point for the compiled single-file binary and for `npx`/global installs.
// Always runs the CLI. The pure helpers stay importable from cli.mjs without
// triggering a run (cli.mjs only self-runs under `node cli.mjs`).
import { main } from "./cli.mjs";

main();
