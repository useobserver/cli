<p align="center">
    <img src="assets/headline.png" alt="Observer CLI" height="100%">
</p>

<p align="center">
  <a href="https://github.com/useobserver/cli/blob/main/LICENSE"><img src="https://img.shields.io/github/license/useobserver/cli?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/useobserver/cli/releases"><img src="https://img.shields.io/github/release/useobserver/cli.svg?style=for-the-badge" alt="Latest Release"></a>
  <a href="https://docs.use.observer"><img src="https://img.shields.io/badge/Documentation-link-blue?style=for-the-badge" alt="Documentation link"></a>
</p>

# Observer CLI

Apply your [Observer](https://use.observer) configuration from version control.
The CLI is a thin client over the Observer public API: your configuration lives
in your repository, is reviewed in pull requests, and is applied through a
workflow you control. Nothing about your monitoring setup is locked inside a UI.

```
observer apply -f observer.yaml --dry-run   # plan: show the diff, change nothing
observer apply -f observer.yaml             # apply: upsert by key
observer export --format yaml -o observer.yaml   # bootstrap from current state
```

## Install

### Binary (recommended)

Downloads the binary for your platform from the latest release and puts it on PATH:

```bash
curl -fsSL https://raw.githubusercontent.com/useobserver/cli/main/install.sh | sh
```

Install to a directory you own (no sudo):

```bash
OBSERVER_INSTALL_DIR="$HOME/.local/bin" \
  curl -fsSL https://raw.githubusercontent.com/useobserver/cli/main/install.sh | sh
```

Or download a specific binary directly from the
[releases page](https://github.com/useobserver/cli/releases/latest):

| Platform        | Asset                          |
| --------------- | ------------------------------ |
| Linux x64       | `observer-linux-x64`           |
| Linux arm64     | `observer-linux-arm64`         |
| macOS Intel     | `observer-darwin-x64`          |
| macOS Apple     | `observer-darwin-arm64`        |
| Windows x64     | `observer-windows-x64.exe`     |

Each release also ships `SHA256SUMS.txt` for verification. The binaries are
self-contained (no runtime to install).

### From source (Node)

The CLI is a single dependency-free script. With Node 20.10+ installed:

```bash
git clone https://github.com/useobserver/cli && cd cli
node bin.mjs apply -f observer.yaml --dry-run
```

### GitHub Action

Use the action directly in a workflow (it runs the CLI with the runner's Node,
so there is no binary to download):

```yaml
- uses: useobserver/cli@v1
  with:
    file: observer.yaml
    mode: ${{ github.event_name == 'pull_request' && 'dry-run' || 'apply' }}
  env:
    OBSERVER_API_URL: ${{ vars.OBSERVER_API_URL }}
    OBSERVER_API_KEY: ${{ secrets.OBSERVER_API_KEY }}
```

This plans on pull requests (failing the check on invalid config) and applies on
merge to your default branch. See [action.yml](./action.yml).

## Configure

```bash
export OBSERVER_API_URL="https://api.use.observer"   # your Observer API base
export OBSERVER_API_KEY="obs_pub_…"                  # key with write:config / read:config
```

Create the key from **Settings → API keys** in the console and grant it the
`write:config` scope (`read:config` is enough for `export`).

## Commands

```bash
# Plan only — show the diff, change nothing (run this on pull requests)
observer apply -f observer.yaml --dry-run

# Apply (upsert by key; never deletes objects not in the document)
observer apply -f observer.yaml

# Also delete config-managed objects removed from the document
observer apply -f observer.yaml --prune

# Bootstrap your repository from current console state
observer export --format yaml -o observer.yaml       # config-managed only
observer export --all --format yaml -o observer.yaml # include console-managed objects

observer --version
observer --help
```

`apply` reads from stdin when the file is `-` (`observer apply -f - < observer.yaml`).

Exit codes: `0` success · `1` validation failure / error · `2` usage error.

## Document shape

```yaml
apiVersion: observer/v1
metrics:
  - key: api-latency # stable id, rename `title` freely
    title: API latency
    source_type: http
    source_config: { url: "https://api.example.com/health" }
    thresholds: { healthy_operation: under, healthy_value: 500, unhealthy_operation: over, unhealthy_value: 2000 }
    interval: 2 # poll minutes (1..60)
    interval_agent_push: 10 # push minutes (5..60, plan floor applies)
    agent: edge-agent # optional: bind by agent name
services:
  - key: api
    name: API
    slos:
      - { key: api-avail, metric: api-latency, target_pct: 99.9, window_days: 30 }
pages:
  - key: status
    subdomain: status
    title: Status
    metrics:
      - { metric: api-latency, group: API, order: 1 }
```

## Reconciliation

- **Upsert-merge by key.** Objects you name are created or updated and marked as
  config-managed. Objects you do not name are left alone, so config you create in
  the console stays safe.
- **Drift:** if someone edits a config-managed object in the console, the next
  apply restores it to the document (config wins for the keys it owns). The
  console shows a drift badge.
- **`--prune`** deletes config-managed objects that disappeared from the
  document. Off by default.

## Development

```bash
node --test            # run the unit tests (no install needed)
bun run build:binaries # cross-compile all platform binaries into dist/ (needs Bun)
```

Releases are cut by pushing a `cli-v*` tag in the source repository; CI builds
every platform binary and attaches them to the GitHub Release.

## License

ISC. See [LICENSE](./LICENSE).
